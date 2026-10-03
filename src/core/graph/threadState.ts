import { isAIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { createLogger, type Logger } from "../log";
import type { CompiledWorkflow } from "./workflow";

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

export async function rehydrateHistory(
  compiled: CompiledWorkflow,
  threadId: string,
  loadHistory: () => Promise<BaseMessage[]>,
  log: Logger = defaultLog
): Promise<void> {
  const existing = await messageCount(compiled, threadId);
  if (existing > 0) {
    log.debug({ threadId, messageCount: existing }, "rehydrateHistory:skip:stateExists");
    return;
  }
  const pastMessages = await loadHistory();
  if (pastMessages.length === 0) {
    log.debug({ threadId }, "rehydrateHistory:skip:emptyHistory");
    return;
  }
  log.info({ threadId, historyLength: pastMessages.length }, "rehydrateHistory:seeding");
  await compiled.updateState({ configurable: { thread_id: threadId } }, { messages: pastMessages });
  log.info(
    { threadId, messageCount: await messageCount(compiled, threadId) },
    "rehydrateHistory:seeded"
  );
}
