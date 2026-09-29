import type { BaseMessage, ToolMessage } from "@langchain/core/messages";
import { saveTurn, saveTurnError } from "../telemetry/session";
import { createLogger } from "../log";
import type { FileStore } from "../ports";
import type { TurnEvent } from "../turn/events";
import type { CompiledWorkflow } from "./workflow";
import { closeUnansweredToolCalls } from "./threadState";

const log = createLogger("pipeline/runner");

export interface TurnRecord {
  turnIndex: number;
  prompt: string | null;
  startCount: number;
  events: TurnEvent[];
}

export function persistCompletedTurn(
  fs: FileStore,
  sessionDir: string,
  messages: BaseMessage[],
  response: string,
  thinking: string,
  turn: TurnRecord
): Promise<string> {
  return saveTurn(fs, sessionDir, {
    turnIndex: turn.turnIndex,
    userPrompt: turn.prompt ?? "",
    agentResponse: response,
    thinking: thinking || undefined,
    agentMessages: messages.slice(turn.startCount),
    events: turn.events,
  });
}

export async function closeToolCallsAfterFailure(
  compiled: CompiledWorkflow,
  threadId: string,
  turnIndex: number,
  error: unknown
): Promise<ToolMessage[]> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    return await closeUnansweredToolCalls(compiled, threadId, `Not run: ${message}`);
  } catch (closeError) {
    log.error("run:closeToolCallsFailed", {
      threadId,
      turnIndex,
      error: closeError instanceof Error ? closeError.message : String(closeError),
    });
    return [];
  }
}

export async function didPersistFailedTurn(
  fs: FileStore,
  sessionDir: string,
  compiled: CompiledWorkflow,
  threadId: string,
  error: unknown,
  turn: TurnRecord
): Promise<boolean> {
  try {
    const failedState = await compiled.getState({ configurable: { thread_id: threadId } });
    const allMessages: BaseMessage[] = failedState?.values?.messages ?? [];
    log.error("run:failed", {
      threadId,
      turnIndex: turn.turnIndex,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      messageCount: allMessages.length,
      next: failedState?.next,
    });
    await saveTurnError(fs, sessionDir, {
      turnIndex: turn.turnIndex,
      userPrompt: turn.prompt ?? "",
      error,
      agentMessages: allMessages.slice(turn.startCount),
      events: turn.events,
    });
    return true;
  } catch (saveError) {
    console.warn("[AgentRunner] Failed to persist turn error:", saveError);
    return false;
  }
}
