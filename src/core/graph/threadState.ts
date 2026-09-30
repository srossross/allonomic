import {
  HumanMessage,
  AIMessage,
  isAIMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { createLogger, type Logger } from "../log";
import type { HistoryEntry } from "../history";
import type { CompiledWorkflow } from "./workflow";
import { thoughtSignatureKwargs } from "./thinking";

const defaultLog = createLogger("pipeline/threadState");

export async function messageCount(compiled: CompiledWorkflow, threadId: string): Promise<number> {
  const state = await compiled.getState({ configurable: { thread_id: threadId } });
  const messages: unknown = state?.values?.messages;
  return Array.isArray(messages) ? messages.length : 0;
}

export async function closeUnansweredToolCalls(
  compiled: CompiledWorkflow,
  threadId: string,
  content: string
): Promise<ToolMessage[]> {
  const config = { configurable: { thread_id: threadId } };
  const state = await compiled.getState(config);
  const messages: BaseMessage[] = state?.values?.messages ?? [];
  const answered = new Set(
    messages.filter((m): m is ToolMessage => m instanceof ToolMessage).map((m) => m.tool_call_id)
  );
  const closers = messages
    .flatMap((m) => (isAIMessage(m) ? (m.tool_calls ?? []) : []))
    .filter((c) => c.id && !answered.has(c.id))
    .map((c) => new ToolMessage({ content, name: c.name, tool_call_id: c.id! }));
  if (closers.length > 0) await compiled.updateState(config, { messages: closers }, "tools");
  return closers;
}

export function historyToMessages(history: HistoryEntry[]): BaseMessage[] {
  return history.map((h) => {
    const content = h.content ?? "";
    if (h.role === "user" || h.role === "human") return new HumanMessage(content);
    if (h.role === "system") return new SystemMessage(content);
    return h.role === "tool"
      ? new ToolMessage({
          content,
          tool_call_id: h.tool_call_id ?? "unknown",
          name: h.name ?? "unknown",
        })
      : new AIMessage({
          content,
          tool_calls: h.tool_calls,
          additional_kwargs: h.tool_calls ? thoughtSignatureKwargs(h.tool_calls) : {},
        });
  });
}

export async function rehydrateHistory(
  compiled: CompiledWorkflow,
  threadId: string,
  history?: HistoryEntry[],
  log: Logger = defaultLog
): Promise<void> {
  if (!history || history.length === 0) {
    log.debug({ threadId }, "rehydrateHistory:skip:emptyHistory");
    return;
  }
  const existing = await messageCount(compiled, threadId);
  if (existing > 0) {
    log.debug({ threadId, messageCount: existing }, "rehydrateHistory:skip:stateExists");
    return;
  }
  log.info({ threadId, historyLength: history.length }, "rehydrateHistory:seeding");

  const pastMessages = historyToMessages(history);
  await compiled.updateState({ configurable: { thread_id: threadId } }, { messages: pastMessages });
  log.info(
    { threadId, messageCount: await messageCount(compiled, threadId) },
    "rehydrateHistory:seeded"
  );
}
