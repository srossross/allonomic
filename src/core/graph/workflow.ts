import {
  MessagesAnnotation,
  StateGraph,
  START,
  type BaseCheckpointSaver,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  isAIMessage,
  type AIMessageChunk,
  type BaseMessage,
  type BaseMessageLike,
} from "@langchain/core/messages";
import { nanoid } from "nanoid";
import { invokeWaiting, TOOL_SOURCE, WORKER_SOURCE } from "../turn/waiting";
import { emitModelUsage, WORKER_AGENT } from "../turn/usage";
import {
  extractThinking,
  messageText,
  sanitizeMessagesForModel,
  stripThinking,
  thoughtSignatureFor,
} from "./thinking";
import { readPipelineContext, type AgentInterceptor } from "./types";
import { inScope, preToolDenial, withPostToolLessons } from "./interceptorHooks";
import { USER_ACTOR } from "../turn/events";
import { briefText, exitRetryText, type Brief } from "../turn/ops";
import { emitToolResults } from "./recovery";
import { userPromptMessage } from "./userPrompt";
import { capToolMessage } from "../tools/toolOutputCap";
import { callIdKwargs, forModel, newCallId, ourToolCalls } from "./callIds";

type State = typeof MessagesAnnotation.State;

export interface WorkflowModel {
  invoke(messages: BaseMessageLike[]): Promise<AIMessage | AIMessageChunk>;
}

export function workerConversation(systemPrompt: string, messages: BaseMessage[]): BaseMessage[] {
  return [new SystemMessage(systemPrompt), ...sanitizeMessagesForModel(messages)];
}

function afterAgentCondition(state: State) {
  const lastMessage = state.messages.at(-1);
  return lastMessage && lastMessage.type === "ai" && Reflect.get(lastMessage, "tool_calls")?.length
    ? "tools"
    : "exit_interceptors";
}

function afterExitCondition(state: State) {
  const lastMessage = state.messages.at(-1);
  return lastMessage && lastMessage.type === "human" ? "inbox" : "__end__";
}

function afterInboxCondition(state: State) {
  const lastMessage = state.messages.at(-1);
  return lastMessage?.type === "human" && lastMessage.additional_kwargs.queueId
    ? "entry_interceptors"
    : "agent";
}

async function inboxNode(_state: State, config: LangGraphRunnableConfig) {
  const context = readPipelineContext(config);
  const { control } = context;
  if (!control) return {};
  if (control.isPaused) {
    context.events.emit({ type: "paused" });
    await control.waitWhilePaused(config.signal);
    context.events.emit({ type: "resumed" });
  }
  const delivered = control.drain();
  if (delivered.length > 0) {
    const user = context.events.scope(USER_ACTOR);
    for (const { id, text } of delivered)
      user.emit({ type: "prompt_delivered", queueId: id, text });
    user.close();
  }
  return {
    messages: delivered.map(({ id, text }) => userPromptMessage(text, { queueId: id })),
  };
}

export function createCompiledWorkflow(
  model: WorkflowModel,
  toolNode: ToolNode,
  checkpointer: BaseCheckpointSaver,
  interceptors: AgentInterceptor[],
  systemPrompt: string,
  modelName: string
) {
  const modelInput = (state: State): BaseMessage[] =>
    workerConversation(systemPrompt, state.messages);
  const interceptorInput = (state: State): BaseMessage[] => [
    new SystemMessage(systemPrompt),
    ...stripThinking(state.messages),
  ];

  const entryInterceptorsNode = async (state: State, config: LangGraphRunnableConfig) => {
    const context = readPipelineContext(config);
    const lastMessage = state.messages.at(-1);
    if (!lastMessage || lastMessage.type !== "human") return {};

    const briefs: Brief[] = [];
    for (const interceptor of interceptors) {
      const { onUserPrompt } = interceptor;
      if (!onUserPrompt) continue;
      const brief = await inScope(
        context,
        interceptor,
        { phase: "entry" },
        async (scoped) => {
          const result = await onUserPrompt.call(interceptor, interceptorInput(state), scoped);
          if (result)
            scoped.events.emit({
              type: "governor_brief",
              interceptor: interceptor.name,
              ...result,
            });
          return result;
        },
        (result) => !result
      );
      if (brief) briefs.push({ interceptor: interceptor.name, text: brief.text });
    }
    return briefs.length === 0 ? {} : { messages: [new HumanMessage(briefText(briefs))] };
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
    const callIds = (response.tool_calls ?? []).map(() => newCallId());
    if (callIds.length > 0)
      response.additional_kwargs = { ...response.additional_kwargs, ...callIdKwargs(callIds) };
    const toolCalls = (response.tool_calls ?? []).map((call, i) => ({
      id: callIds[i],
      providerId: call.id,
      name: call.name,
      args: call.args,
      thoughtSignature: call.id ? thoughtSignatureFor(response, call.id) : undefined,
    }));
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
    emitModelUsage(context.events, WORKER_AGENT, modelName, response);
    return { messages: [response] };
  };

  const toolsNode = async (state: State, config: LangGraphRunnableConfig) => {
    const context = readPipelineContext(config);
    const conversation = modelInput(state);
    const last = state.messages.at(-1);
    const step = last && isAIMessage(last) ? last : undefined;
    const calls = step ? ourToolCalls(step) : [];
    const providerIds = new Map(calls.map((call, i) => [call.id, step?.tool_calls?.[i]?.id]));

    await context.recordSettings?.();
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
      { messages: [new AIMessage({ content: "", tool_calls: calls }), ...denials] },
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
        if (!result) return;
        const capped = await capToolMessage(result, context.storeToolOutput);
        return withPostToolLessons(interceptors, call, capped, conversation, context);
      })
    );
    const results = [...denials, ...taught.filter((m) => m !== undefined)];
    const messages = calls
      .map((call) => results.find((m) => m.tool_call_id === call.id))
      .filter((m) => m !== undefined);

    emitToolResults(context.events, messages);
    return { messages: messages.map((m) => forModel(m, providerIds.get(m.tool_call_id))) };
  };

  const exitInterceptorsNode = async (state: State, config: LangGraphRunnableConfig) => {
    const context = readPipelineContext(config);
    const feedback: string[] = [];

    for (const interceptor of interceptors) {
      const { onAgentFinish } = interceptor;
      if (!onAgentFinish) continue;
      const verdict = await inScope(
        context,
        interceptor,
        { phase: "exit" },
        (scoped) => onAgentFinish.call(interceptor, interceptorInput(state), scoped),
        (result) => result.allowFinish
      );
      if (!verdict.allowFinish)
        feedback.push(`\n[${interceptor.name} Feedback]: ${verdict.feedback ?? ""}`);
    }

    if (feedback.length === 0) {
      for (const interceptor of interceptors) {
        const { onPresent } = interceptor;
        if (!onPresent) continue;
        await inScope(
          context,
          interceptor,
          { phase: "present" },
          (scoped) => onPresent.call(interceptor, interceptorInput(state), scoped),
          () => false
        );
      }
      return {};
    }
    const combined = feedback.join("");
    context.events.emit({ type: "exit_retry", feedback: combined });
    return { messages: [new HumanMessage(exitRetryText(combined))] };
  };

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("entry_interceptors", entryInterceptorsNode)
    .addNode("agent", callModel)
    .addNode("tools", toolsNode)
    .addNode("inbox", inboxNode)
    .addNode("exit_interceptors", exitInterceptorsNode)
    .addEdge(START, "entry_interceptors")
    .addEdge("entry_interceptors", "agent")
    .addConditionalEdges("agent", afterAgentCondition, ["tools", "exit_interceptors"])
    .addEdge("tools", "inbox")
    .addConditionalEdges("inbox", afterInboxCondition, ["entry_interceptors", "agent"])
    .addConditionalEdges("exit_interceptors", afterExitCondition, ["inbox", "__end__"]);

  return workflow.compile({ checkpointer });
}

export type CompiledWorkflow = ReturnType<typeof createCompiledWorkflow>;
