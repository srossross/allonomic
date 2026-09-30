/**
 * @ai-instruction DO NOT replace this system with an opaque database (like SqliteSaver).
 * We deliberately use an Event-Sourced YAML architecture so that all agent thoughts,
 * tool calls, and state transitions remain human-readable, auditable, and manually editable on disk.
 */
import type { FileStore } from "../ports";
import type { RehydratedSession, SessionLoadError, SessionMetadata } from "../../types/persistence";
import { loadSessionMetadata, saveSessionMetadata, sessionDirFor } from "./metadata";
import { loadSessionTurns, nextTurnIndexAfter } from "../turn/turnFiles";
import { foldTurnEvents } from "../turn/transcript";
import type { RecoverableCall, TurnEvent } from "../turn/events";
import { saveTurnEvents } from "../telemetry/session";
import { createLogger } from "../log";

const log = createLogger("session.rehydration");

async function loadOrCreateMetadata(
  fs: FileStore,
  workspaceDir: string,
  sessionId: string
): Promise<SessionMetadata> {
  const existing = await loadSessionMetadata(fs, workspaceDir, sessionId);
  if (existing) return existing;
  const metadata: SessionMetadata = {
    sessionId,
    title: sessionId,
    closed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveSessionMetadata(fs, workspaceDir, metadata);
  return metadata;
}

function isTerminal(event: TurnEvent): boolean {
  return event.type === "turn_completed" || event.type === "turn_failed";
}

async function closeUnfinishedTurn(
  fs: FileStore,
  sessionDir: string,
  turnNumbers: number[],
  events: TurnEvent[]
): Promise<TurnEvent | undefined> {
  const lastTurn = turnNumbers.at(-1);
  const turnEvents = events.filter((e) => e.turnIndex === lastTurn);
  if (lastTurn === undefined || turnEvents.length === 0 || turnEvents.some((e) => isTerminal(e)))
    return;
  const failed: TurnEvent = {
    type: "turn_failed",
    error: "The app shut down during this turn",
    aborted: false,
    seq: (turnEvents.at(-1)?.seq ?? -1) + 1,
    at: new Date().toISOString(),
    turnIndex: lastTurn,
  };
  const last = turnEvents.at(-1);
  log.warn(
    { sessionDir, turnIndex: lastTurn, lastEventType: last?.type, lastEventAt: last?.at },
    "closing unfinished turn after shutdown"
  );
  await saveTurnEvents(fs, sessionDir, lastTurn, [...turnEvents, failed]);
  return failed;
}

function findUnansweredCalls(events: TurnEvent[]): RecoverableCall[] {
  const answered = new Set(events.flatMap((e) => (e.type === "tool_result" ? [e.toolCallId] : [])));
  const decidedBy = (id: string) =>
    events.flatMap((e) =>
      e.type === "governor_tool_decision" && e.toolCallId === id ? [e.interceptor] : []
    );
  return events.flatMap((e) =>
    e.type === "model_step"
      ? e.toolCalls
          .filter((call) => !answered.has(call.id))
          .map((call) => ({ ...call, decidedBy: decidedBy(call.id) }))
      : []
  );
}

export async function rehydrateSession(
  fs: FileStore,
  workspaceDir: string,
  sessionId: string
): Promise<RehydratedSession> {
  const sessionDir = sessionDirFor(workspaceDir, sessionId);
  const metadata = await loadOrCreateMetadata(fs, workspaceDir, sessionId);
  const loadErrors: SessionLoadError[] = [];
  const { turnNumbers, events } = await loadSessionTurns(fs, sessionDir, (turnIndex, error) => {
    log.error(
      { turnIndex, error: error instanceof Error ? error.message : String(error) },
      "turn load failed"
    );
    loadErrors.push({
      turnIndex,
      message: error instanceof Error ? error.message : String(error),
    });
  });
  const closed = await closeUnfinishedTurn(fs, sessionDir, turnNumbers, events);
  const allEvents = closed ? [...events, closed] : events;
  return {
    metadata,
    ...foldTurnEvents(allEvents),
    nextTurnIndex: nextTurnIndexAfter(turnNumbers),
    loadErrors,
    unansweredCalls: findUnansweredCalls(allEvents),
  };
}
