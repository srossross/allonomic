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
import { invokeWithRetry } from "../retry";
import { extractThinking, messageText, sanitizeMessagesForModel } from "./thinking";
import {
  readPipelineContext,
  type AgentInterceptor,
  type PipelineContext,
  type ToolCall,
} from "./types";
import { isPendingToolResult } from "../userPrompt";

type State = typeof MessagesAnnotation.State;

export interface WorkflowModel {
  invoke(messages: BaseMessageLike[]): Promise<AIMessage | AIMessageChunk>;
}

function toolContent(message: ToolMessage): string {
  return typeof message.content === "string" ? message.content : JSON.stringify(message.content);
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

function afterToolsCondition(state: State) {
  const lastMessage = state.messages.at(-1);
  return lastMessage && isPendingToolResult(lastMessage.content) ? "__end__" : "agent";
}

export function createCompiledWorkflow(
  model: WorkflowModel,
  toolNode: ToolNode,
  checkpointer: BaseCheckpointSaver,
  interceptors: AgentInterceptor[],
  systemPrompt: string
) {
  const systemMessage = new SystemMessage(systemPrompt);
  const modelInput = (state: State): BaseMessage[] => [
    systemMessage,
    ...sanitizeMessagesForModel(state.messages),
  ];

  const entryInterceptorsNode = async (state: State, config: LangGraphRunnableConfig) => {
    const context = readPipelineContext(config);
    const lastMessage = state.messages.at(-1);
    if (!lastMessage || lastMessage._getType() !== "human") return {};

    for (const interceptor of interceptors) {
      await interceptor.onUserPrompt?.(modelInput(state), context);
    }
    return {};
  };

  const callModel = async (state: State, config: LangGraphRunnableConfig) => {
    const context = readPipelineContext(config);
    const messages = modelInput(state);
    const startedAt = Date.now();
    const response = await invokeWithRetry(() => model.invoke(messages));
    response.id ??= `step_${nanoid()}`;
    const toolCalls = (response.tool_calls ?? []).map((call) => {
      call.id ??= `call_${nanoid()}`;
      return { id: call.id, name: call.name, args: call.args };
    });
    const thinking = extractThinking(response);
    context.events.emit({
      type: "model_step",
      stepId: response.id,
      content: messageText(response.content),
      thinking: thinking || undefined,
      toolCalls,
      durationMs: Date.now() - startedAt,
    });
    return { messages: [response] };
  };

  const denialFor = async (
    call: ToolCall,
    conversation: BaseMessage[],
    context: PipelineContext
  ): Promise<ToolMessage | null> => {
    for (const interceptor of interceptors) {
      if (!interceptor.onPreToolCall) continue;
      const approval = await interceptor.onPreToolCall(call, conversation, context);
      if (!approval.approved) {
        return new ToolMessage({
          status: "error",
          content: `[INTERCEPTED by ${interceptor.name}]: ${approval.reason}`,
          tool_call_id: call.id ?? "",
          name: call.name,
        });
      }
    }
    return null;
  };

  const toolsNode = async (state: State, config: LangGraphRunnableConfig) => {
    const context = readPipelineContext(config);
    const conversation = modelInput(state);
    const last = state.messages.at(-1);
    const calls = last && isAIMessage(last) ? (last.tool_calls ?? []) : [];

    const verdicts = await Promise.all(calls.map((call) => denialFor(call, conversation, context)));
    const denials = verdicts.filter((m) => m !== null);

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
    const results = [...denials, ...executed];
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
    .addConditionalEdges("tools", afterToolsCondition, ["agent", "__end__"])
    .addConditionalEdges("exit_interceptors", afterExitCondition, ["agent", "__end__"]);

  return workflow.compile({ checkpointer });
}

export type CompiledWorkflow = ReturnType<typeof createCompiledWorkflow>;
