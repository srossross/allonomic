import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { createLogger } from "../log";
import type { HistoryEntry } from "../history";
import type { ToolCallStatus, UserPromptValue } from "../../types/tools";
import { createRejectedResult, createResponseResult, decodeToolResult } from "../userPrompt";
import type { CompiledWorkflow } from "./workflow";

const log = createLogger("pipeline/threadState");

export type ApprovedToolInvoker = (name: string, args: Record<string, unknown>) => Promise<string>;

export interface PromptResponseResult {
  index: number;
  toolCallId: string;
  name: string;
  status: ToolCallStatus;
  result: string;
}

function findToolCallArgs(
  messages: BaseMessage[],
  toolId: string
): { name: string; args: Record<string, unknown> } | null {
  for (const m of messages) {
    if (!(m instanceof AIMessage)) continue;
    const match = m.tool_calls?.find((c) => c.id === toolId);
    if (match) return { name: match.name, args: match.args };
  }
  return null;
}

export async function messageCount(compiled: CompiledWorkflow, threadId: string): Promise<number> {
  const state = await compiled.getState({ configurable: { thread_id: threadId } });
  const messages: unknown = state?.values?.messages;
  return Array.isArray(messages) ? messages.length : 0;
}

export async function respondToPromptResult(
  compiled: CompiledWorkflow,
  threadId: string,
  toolId: string,
  value: UserPromptValue,
  invokeApproved: ApprovedToolInvoker
): Promise<PromptResponseResult | null> {
  const config = { configurable: { thread_id: threadId } };
  const state = await compiled.getState(config);
  log.info("resumeTool:state", {
    threadId,
    toolId,
    hasState: !!state,
    messageCount: state?.values?.messages?.length ?? 0,
    next: state?.next,
    checkpointId: state?.config?.configurable?.checkpoint_id,
  });
  if (!state?.values?.messages) {
    log.warn("resumeTool:noState", { threadId, toolId });
    return null;
  }

  const messages: BaseMessage[] = state.values.messages;
  const index = messages.findIndex(
    (m) => m._getType() === "tool" && Reflect.get(m, "tool_call_id") === toolId
  );
  if (index === -1) {
    log.warn("resumeTool:toolMessageNotFound", {
      threadId,
      toolId,
      toolMessages: messages
        .filter((m) => m._getType() === "tool")
        .map((m) => ({ name: m.name, toolCallId: Reflect.get(m, "tool_call_id") })),
    });
    return null;
  }

  const oldMessage = messages[index];
  if (!oldMessage.id) {
    throw new Error(
      `Tool message for ${toolId} has no id; updateState would append instead of replace`
    );
  }

  const decoded = decodeToolResult(oldMessage.content);
  if (decoded.status !== "pending") {
    log.warn("resumeTool:notPending", { threadId, toolId, status: decoded.status });
    return null;
  }

  const call = findToolCallArgs(messages, toolId);
  if (!call) {
    log.warn("resumeTool:toolCallNotFound", { threadId, toolId });
    return null;
  }

  const { prompt } = decoded;
  let status: ToolCallStatus;
  let result: string;
  if (prompt.kind === "confirm") {
    if (typeof value !== "boolean")
      throw new Error(`confirm prompt expects a boolean, got ${typeof value}`);
    if (value) {
      result = await invokeApproved(call.name, call.args);
      status = "approved";
    } else {
      result = createRejectedResult(call.name, prompt);
      status = "rejected";
    }
  } else {
    if (typeof value !== "string")
      throw new Error(`${prompt.kind} prompt expects a string, got ${typeof value}`);
    result = createResponseResult(prompt, value);
    status = "executed";
  }

  const patched = new ToolMessage({
    content: result,
    name: oldMessage.name,
    tool_call_id: toolId,
  });
  patched.id = oldMessage.id;

  await compiled.updateState(config, { messages: [patched] }, "tools");
  const after = await compiled.getState(config);
  log.info("resumeTool:updated", {
    threadId,
    toolId,
    index,
    status,
    next: after?.next,
    messageCount: after?.values?.messages?.length ?? 0,
  });
  return { index, toolCallId: toolId, name: call.name, status, result };
}

export async function rehydrateHistory(
  compiled: CompiledWorkflow,
  threadId: string,
  history?: HistoryEntry[]
): Promise<void> {
  if (!history || history.length === 0) {
    log.debug("rehydrateHistory:skip:emptyHistory", { threadId });
    return;
  }
  const existing = await messageCount(compiled, threadId);
  if (existing > 0) {
    log.debug("rehydrateHistory:skip:stateExists", { threadId, messageCount: existing });
    return;
  }
  log.info("rehydrateHistory:seeding", { threadId, historyLength: history.length });

  const pastMessages = history.map((h) => {
    const content = h.content ?? "";
    if (h.role === "user" || h.role === "human") return new HumanMessage(content);
    if (h.role === "system") return new SystemMessage(content);
    return h.role === "tool"
      ? new ToolMessage({
          content,
          tool_call_id: h.tool_call_id ?? "unknown",
          name: h.name ?? "unknown",
        })
      : new AIMessage({ content, tool_calls: h.tool_calls });
  });
  await compiled.updateState({ configurable: { thread_id: threadId } }, { messages: pastMessages });
  log.info("rehydrateHistory:seeded", {
    threadId,
    messageCount: await messageCount(compiled, threadId),
  });
}
