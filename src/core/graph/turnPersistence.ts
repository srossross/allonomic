import type { BaseMessage } from "@langchain/core/messages";
import { saveTurn, saveTurnError } from "../telemetry/session";
import type { Logger } from "../log";
import type { FileStore } from "../ports";
import type { TurnEvent, TurnEventSink } from "../turn/events";
import type { CompiledWorkflow } from "./workflow";
import { closeUnansweredToolCalls } from "./threadState";
import { emitToolResults } from "./recovery";

export interface TurnRecord {
  turnIndex: number;
  prompt: string | null;
  startCount: number;
  events: TurnEvent[];
}

export interface FailedTurn {
  log: Logger;
  fs: FileStore;
  sessionDir: string;
  compiled: CompiledWorkflow;
  threadId: string;
  sink: TurnEventSink;
  aborted: boolean;
  record: TurnRecord;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

async function collectFailures(steps: Array<() => unknown>): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

function withSecondaryFailures(error: unknown, secondary: unknown[]): unknown {
  if (secondary.length === 0) return error;
  const also = secondary.map((failure) => errorText(failure)).join("; ");
  return new AggregateError([error, ...secondary], `${errorText(error)} (also failed: ${also})`, {
    cause: error,
  });
}

async function persistFailedTurn(error: unknown, turn: FailedTurn): Promise<void> {
  const { log, fs, sessionDir, compiled, threadId, record } = turn;
  const failedState = await compiled.getState({ configurable: { thread_id: threadId } });
  const allMessages: BaseMessage[] = failedState?.values?.messages ?? [];
  log.error(
    {
      threadId,
      turnIndex: record.turnIndex,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      messageCount: allMessages.length,
      next: failedState?.next,
    },
    "run:failed"
  );
  await saveTurnError(fs, sessionDir, {
    turnIndex: record.turnIndex,
    userPrompt: record.prompt ?? "",
    error,
    agentMessages: allMessages.slice(record.startCount),
    events: record.events,
  });
}

export async function failTurn(
  error: unknown,
  turn: FailedTurn
): Promise<{ failure: unknown; isSaved: boolean }> {
  const message = errorText(error);
  let isSaved = false;
  const secondary = await collectFailures([
    async () =>
      emitToolResults(
        turn.sink,
        await closeUnansweredToolCalls(turn.compiled, turn.threadId, `Not run: ${message}`)
      ),
    () =>
      turn.sink.emit({
        type: "turn_failed",
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
        aborted: turn.aborted,
      }),
    async () => {
      await persistFailedTurn(error, turn);
      isSaved = true;
    },
  ]);
  return { failure: withSecondaryFailures(error, secondary), isSaved };
}
