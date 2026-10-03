/**
 * @ai-instruction DO NOT replace this system with an opaque database (like SqliteSaver).
 * We deliberately use an Event-Sourced JSONL architecture so that all agent thoughts,
 * tool calls, and state transitions remain human-readable, auditable, and manually editable on disk.
 */
import type { BaseMessage } from "@langchain/core/messages";
import type { FileStore } from "../ports";
import type { RehydratedSession, SessionLoadError, SessionMetadata } from "../../types/persistence";
import { loadSessionMetadata, saveSessionMetadata, sessionDirFor } from "./metadata";
import { appendTurnEvent, loadSessionTurns, nextTurnIndexAfter } from "../turn/turnFiles";
import { foldTurnEvents } from "../turn/transcript";
import { replayWorkerMessages } from "../turn/ops";
import { WORKER_ACTOR, type RecoverableCall, type TurnEvent } from "../turn/events";
import { applyGovernorAction, EMPTY_GOVERNOR_STATE } from "../governor/reducer";
import type { GovernorState } from "../governor/types";
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
    actor: WORKER_ACTOR,
  };
  const last = turnEvents.at(-1);
  log.warn(
    { sessionDir, turnIndex: lastTurn, lastEventType: last?.type, lastEventAt: last?.at },
    "closing unfinished turn after shutdown"
  );
  await appendTurnEvent(fs, sessionDir, failed);
  return failed;
}

function findUnansweredCalls(events: TurnEvent[]): RecoverableCall[] {
  const answered = new Set(events.flatMap((e) => (e.type === "tool_result" ? [e.toolCallId] : [])));
  const decidedBy = (id: string) =>
    events.flatMap((e) =>
      (e.type === "governor_tool_decision" && e.toolCallId === id) ||
      (e.type === "interceptor_passed" && e.phase === "pre_tool" && e.toolCallId === id)
        ? [e.interceptor]
        : []
    );
  return events.flatMap((e) =>
    e.type === "model_step"
      ? e.toolCalls
          .filter((call) => !answered.has(call.id))
          .map((call) => ({ ...call, decidedBy: decidedBy(call.id) }))
      : []
  );
}

export function replayGovernorState(events: TurnEvent[]): GovernorState {
  let state = EMPTY_GOVERNOR_STATE;
  for (const event of events) {
    if (event.type === "governor_action") state = applyGovernorAction(state, event.action).state;
  }
  return state;
}

function failOnTurnError(turnIndex: number, error: unknown): never {
  throw new Error(`Failed to load turn ${turnIndex}: ${errorText(error)}`, { cause: error });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loadWorkerMessages(
  fs: FileStore,
  sessionDir: string,
  beforeTurn: number
): Promise<BaseMessage[]> {
  const { events } = await loadSessionTurns(fs, sessionDir, failOnTurnError, beforeTurn - 1);
  return replayWorkerMessages(events);
}

export interface SessionReplay {
  events: TurnEvent[];
  nextTurnIndex: number;
  loadErrors: SessionLoadError[];
  unansweredCalls: RecoverableCall[];
}

export async function replaySession(fs: FileStore, sessionDir: string): Promise<SessionReplay> {
  const loadErrors: SessionLoadError[] = [];
  const { turnNumbers, events } = await loadSessionTurns(fs, sessionDir, (turnIndex, error) => {
    log.error({ turnIndex, error: errorText(error) }, "turn load failed");
    loadErrors.push({ turnIndex, message: errorText(error) });
  });
  const closed = await closeUnfinishedTurn(fs, sessionDir, turnNumbers, events);
  const allEvents = closed ? [...events, closed] : events;
  return {
    events: allEvents,
    nextTurnIndex: nextTurnIndexAfter(turnNumbers),
    loadErrors,
    unansweredCalls: findUnansweredCalls(allEvents),
  };
}

export async function rehydrateSession(
  fs: FileStore,
  workspaceDir: string,
  sessionId: string
): Promise<RehydratedSession> {
  const metadata = await loadOrCreateMetadata(fs, workspaceDir, sessionId);
  const { events, ...replay } = await replaySession(fs, sessionDirFor(workspaceDir, sessionId));
  return { metadata, ...foldTurnEvents(events), ...replay };
}
