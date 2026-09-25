import { MessagesAnnotation, StateGraph, START, MemorySaver } from "@langchain/langgraph";
import { ToolNode,   } from "@langchain/langgraph/prebuilt";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { invokeWithRetry } from "../../common/retry";
import { sanitizeMessagesForModel } from "./thinking";

export type TraceCallback = (message: string) => void;

export function createCompiledWorkflow(
  model: ChatGoogleGenerativeAI | ReturnType<ChatGoogleGenerativeAI["bindTools"]>,
  toolNode: ToolNode,
  checkpointer: MemorySaver,
  interceptors: AgentInterceptor[],
  onTrace?: TraceCallback
) {
  const systemMessage = {
    role: "system",
    content:
      "You are an expert software engineer with access to local tools. Inspect the codebase, read relevant files, and fulfill user requests directly.",
  };

  const entryInterceptorsNode = async (state: typeof MessagesAnnotation.State, config: Record<string, unknown>) => {
    const context = config.configurable?.context;
    // Only run on the very first human message of a turn
    const lastMessage = state.messages.at(-1);
    if (!lastMessage || lastMessage._getType() !== "human") return {};
    const prompt = typeof lastMessage.content === "string" ? lastMessage.content : JSON.stringify(lastMessage.content);
    
    for (const interceptor of interceptors) {
      if (!interceptor.onUserPrompt) {
        continue;
      }

      onTrace?.(`[INTERCEPTOR] Running entry onUserPrompt for ${interceptor.name}`);
      await interceptor.onUserPrompt(prompt, context);
    }
    return {};
  };

  const callModel = async (state: typeof MessagesAnnotation.State) => {
    const stepCount = state.messages.length;
    const sanitizedMessages = sanitizeMessagesForModel(state.messages);
    const messages = [systemMessage, ...sanitizedMessages];
    onTrace?.(`[STEP ${stepCount}] Invoking model with ${messages.length} messages.`);
    const response = await invokeWithRetry(() => model.invoke(messages));
    if (response.tool_calls && response.tool_calls.length > 0) {
      onTrace?.(
        `[STEP ${stepCount}] Model requested ${response.tool_calls.length} tool(s): ${response.tool_calls.map((t) => t.name).join(", ")}`
      );
    } else {
      onTrace?.(`[STEP ${stepCount}] Model emitted response without tool calls.`);
    }
    return { messages: [response] };
  };

  const exitInterceptorsNode = async (state: typeof MessagesAnnotation.State, config: Record<string, unknown>) => {
    const context = config.configurable?.context;
    let isNeedsRetry = false;
    let combinedFeedback = "";

    for (const interceptor of interceptors) {
      if (!interceptor.onAgentFinish) continue;
      const verdict = await interceptor.onAgentFinish(state.messages, context);
      if (verdict.allowFinish) continue;
      isNeedsRetry = true;
      combinedFeedback += `\n[${interceptor.name} Feedback]: ${verdict.feedback}`;
    }

    if (isNeedsRetry) {
      return {
        messages: [
          new HumanMessage(
            `Your output did not satisfy the exit criteria:${combinedFeedback}\nPlease address this feedback to complete the task.`
          ),
        ],
      };
    }
    return {};
  };

  const afterAgentCondition = (state: typeof MessagesAnnotation.State) => {
    const lastMessage = state.messages.at(-1);
    return lastMessage && lastMessage._getType() === "ai" && Reflect.get(lastMessage, "tool_calls")?.length ? "tools" : "exit_interceptors";
  };

  const afterExitCondition = (state: typeof MessagesAnnotation.State) => {
    const lastMessage = state.messages.at(-1);
    if (lastMessage && lastMessage._getType() === "human") {
      return "agent"; // Rejected, loop back
    }
    return "__end__";
  };

  const afterToolsCondition = (state: typeof MessagesAnnotation.State) => {
    const stepCount = state.messages.length;
    const lastMessage = state.messages.at(-1);
    const isPendingApproval =
      lastMessage &&
      typeof lastMessage.content === "string" &&
      lastMessage.content.startsWith("[PENDING_APPROVAL]");
    const nextNode = isPendingApproval ? "__end__" : "agent";
    onTrace?.(
      `[AFTER_TOOLS] Routing condition: ${isPendingApproval ? "Approval pending -> __end__" : "Tools completed -> agent (step " + stepCount + ")"}`
    );
    return nextNode;
  };

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("entry_interceptors", entryInterceptorsNode)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addNode("exit_interceptors", exitInterceptorsNode)
    .addEdge(START, "entry_interceptors")
    .addEdge("entry_interceptors", "agent")
    .addConditionalEdges("agent", afterAgentCondition, ["tools", "exit_interceptors"])
    .addConditionalEdges("tools", afterToolsCondition, ["agent", "__end__"])
    .addConditionalEdges("exit_interceptors", afterExitCondition, ["agent", "__end__"]);

  return workflow.compile({ checkpointer });
}

export type CompiledWorkflow = ReturnType<typeof createCompiledWorkflow>;

import { HumanMessage, AIMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { AgentInterceptor, PipelineContext } from "./types";

export async function rehydrateHistory(
  compiled: CompiledWorkflow,
  threadId: string,
  history?: Array<{ role: string; content: string }>
): Promise<void> {
  if (!history || history.length === 0) return;
  const state = await compiled.getState({ configurable: { thread_id: threadId } });
  if (state?.values?.messages && state.values.messages.length > 0) return;

  const pastMessages = history.map((h: Record<string, unknown>) => {
    if (h.role === "user" || h.role === "human") return new HumanMessage(h.content);
    if (h.role === "system") return new SystemMessage(h.content);
    return h.role === "tool" ? new ToolMessage({ content: h.content, tool_call_id: h.tool_call_id || "unknown", name: h.name || "unknown" }) : new AIMessage({ content: h.content, tool_calls: h.tool_calls });
  });
  await compiled.updateState(
    { configurable: { thread_id: threadId } },
    { messages: pastMessages }
  );
}

export async function checkExitInterceptors(
  interceptors: AgentInterceptor[],
  messages: BaseMessage[],
  context: PipelineContext
): Promise<{ isNeedsRetry: boolean; combinedFeedback: string }> {
  let isNeedsRetry = false;
  let combinedFeedback = "";

  for (const interceptor of interceptors) {
    if (!interceptor.onAgentFinish) continue;

    const verdict = await interceptor.onAgentFinish(messages, context);
    if (verdict.allowFinish) continue;

    isNeedsRetry = true;
    combinedFeedback += `\n[${interceptor.name} Feedback]: ${verdict.feedback}`;
  }

  return { isNeedsRetry, combinedFeedback };
}
