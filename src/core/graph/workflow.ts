import {
  MessagesAnnotation,
  StateGraph,
  START,
  type BaseCheckpointSaver,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  isAIMessage,
  type AIMessage,
  type AIMessageChunk,
  type BaseMessage,
  type BaseMessageLike,
} from "@langchain/core/messages";
import { nanoid } from "nanoid";
import { invokeWaiting, TOOL_SOURCE, WORKER_SOURCE } from "../turn/waiting";
import {
  extractThinking,
  messageText,
  sanitizeMessagesForModel,
  thoughtSignatureFor,
} from "./thinking";
import { readPipelineContext, type AgentInterceptor } from "./types";
import { preToolDenial, toolContent, withPostToolLessons } from "./interceptorHooks";

type State = typeof MessagesAnnotation.State;

export interface WorkflowModel {
  invoke(messages: BaseMessageLike[]): Promise<AIMessage | AIMessageChunk>;
}

export function workerConversation(systemPrompt: string, messages: BaseMessage[]): BaseMessage[] {
  return [new SystemMessage(systemPrompt), ...sanitizeMessagesForModel(messages)];
}

function afterAgentCondition(state: State) {
  const lastMessage = state.messages.at(-1);
  return lastMessage &&
    lastMessage._getType() === "ai" &&
    Reflect.get(lastMessage, "tool_calls")?.length
    ? "tools"
    : "exit_interceptors";
}

function afterExitCondition(state: State) {
  const lastMessage = state.messages.at(-1);
  return lastMessage && lastMessage._getType() === "human" ? "agent" : "__end__";
}

export function createCompiledWorkflow(
  model: WorkflowModel,
  toolNode: ToolNode,
  checkpointer: BaseCheckpointSaver,
  interceptors: AgentInterceptor[],
  systemPrompt: string
) {
  const modelInput = (state: State): BaseMessage[] =>
    workerConversation(systemPrompt, state.messages);

  const entryInterceptorsNode = async (state: State, config: LangGraphRunnableConfig) => {
    const context = readPipelineContext(config);
    const lastMessage = state.messages.at(-1);
    if (!lastMessage || lastMessage._getType() !== "human") return {};

    const briefs: string[] = [];
    for (const interceptor of interceptors) {
      const brief = await interceptor.onUserPrompt?.(modelInput(state), context);
      if (brief) briefs.push(`[${interceptor.name}]: ${brief}`);
    }
    if (briefs.length === 0) return {};
    return { messages: [new HumanMessage(briefs.join("\n\n"))] };
  };

  const callModel = async (state: State, config: LangGraphRunnableConfig) => {
    const context = readPipelineContext(config);
    const messages = modelInput(state);
    const startedAt = Date.now();
    const response = await invokeWaiting(
      { events: context.events, source: WORKER_SOURCE },
      "Worker model",
      () => model.invoke(messages)
    );
    response.id ??= `step_${nanoid()}`;
    const toolCalls = (response.tool_calls ?? []).map((call) => {
      call.id ??= `call_${nanoid()}`;
      return {
        id: call.id,
        name: call.name,
        args: call.args,
        thoughtSignature: thoughtSignatureFor(response, call.id),
      };
    });
    const thinking = extractThinking(response);
    context.events.emit({
      type: "model_step",
      stepId: response.id,
      content: messageText(response.content),
      thinking: thinking || undefined,
      toolCalls,
      durationMs: Date.now() - startedAt,
      inputTokens: response.usage_metadata?.input_tokens,
    });
    return { messages: [response] };
  };

  const toolsNode = async (state: State, config: LangGraphRunnableConfig) => {
    const context = readPipelineContext(config);
    const conversation = modelInput(state);
    const last = state.messages.at(-1);
    const calls = last && isAIMessage(last) ? (last.tool_calls ?? []) : [];

    const verdicts = await Promise.all(
      calls.map((call) => preToolDenial(interceptors, call, conversation, context))
    );
    const denials = verdicts.filter((m) => m !== null);
    const approved = calls.filter((call) => denials.every((d) => d.tool_call_id !== call.id));
    if (approved.length > 0)
      context.events.emit({
        type: "waiting",
        on: `Running ${approved.map((call) => call.name).join(", ")}`,
        source: TOOL_SOURCE,
      });

    // ToolNode skips calls that already have a ToolMessage, so only approved calls execute.
    const output: unknown = await toolNode.invoke(
      { messages: [...state.messages, ...denials] },
      config
    );
    const raw: unknown =
      typeof output === "object" && output !== null ? Reflect.get(output, "messages") : undefined;
    const executed = Array.isArray(raw)
      ? raw.filter((m: unknown): m is ToolMessage => m instanceof ToolMessage)
      : [];
    const taught = await Promise.all(
      calls.map(async (call) => {
        const result = executed.find((m) => m.tool_call_id === call.id);
        return result && withPostToolLessons(interceptors, call, result, conversation, context);
      })
    );
    const results = [...denials, ...taught.filter((m) => m !== undefined)];
    const messages = calls
      .map((call) => results.find((m) => m.tool_call_id === call.id))
      .filter((m) => m !== undefined);

    for (const message of messages) {
      context.events.emit({
        type: "tool_result",
        toolCallId: message.tool_call_id,
        name: message.name ?? "tool",
        content: toolContent(message),
        status: message.status,
      });
    }
    return { messages };
  };

  const exitInterceptorsNode = async (state: State, config: LangGraphRunnableConfig) => {
    const context = readPipelineContext(config);
    const feedback: string[] = [];

    for (const interceptor of interceptors) {
      if (!interceptor.onAgentFinish) continue;
      const verdict = await interceptor.onAgentFinish(modelInput(state), context);
      if (!verdict.allowFinish)
        feedback.push(`\n[${interceptor.name} Feedback]: ${verdict.feedback}`);
    }

    if (feedback.length === 0) return {};
    const combined = feedback.join("");
    context.events.emit({ type: "exit_retry", feedback: combined });
    return {
      messages: [
        new HumanMessage(
          `Your output did not satisfy the exit criteria:${combined}\nPlease address this feedback to complete the task.`
        ),
      ],
    };
  };

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("entry_interceptors", entryInterceptorsNode)
    .addNode("agent", callModel)
    .addNode("tools", toolsNode)
    .addNode("exit_interceptors", exitInterceptorsNode)
    .addEdge(START, "entry_interceptors")
    .addEdge("entry_interceptors", "agent")
    .addConditionalEdges("agent", afterAgentCondition, ["tools", "exit_interceptors"])
    .addEdge("tools", "agent")
    .addConditionalEdges("exit_interceptors", afterExitCondition, ["agent", "__end__"]);

  return workflow.compile({ checkpointer });
}

export type CompiledWorkflow = ReturnType<typeof createCompiledWorkflow>;
