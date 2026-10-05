/**
 * @ai-instruction DO NOT replace this system with an opaque database (like SqliteSaver).
 * We deliberately use an Event-Sourced JSONL architecture so that all agent thoughts,
 * tool calls, and state transitions remain human-readable, auditable, and manually editable on disk.
 */
import type { BaseMessage } from "@langchain/core/messages";
import type { FileStore } from "../ports";
import type { RehydratedSession, SessionLoadError, SessionMetadata } from "../../types/persistence";
import { loadSessionMetadata, saveSessionMetadata, sessionDirFor } from "./metadata";
import {
  appendSegmentEvents,
  appendTurnEvent,
  loadSessionTurns,
  nextTurnIndexAfter,
  segmentFileName,
  turnDirFor,
} from "../turn/turnFiles";
import { foldTurnEvents, emptyTranscript, type Transcript } from "../turn/transcript";
import { join } from "../paths";
import { activeEvents, activePath, buildTurnTree, type TurnHead } from "../turn/branches";
import { replayWorkerMessages } from "../turn/ops";
import { USER_ACTOR, WORKER_ACTOR, type RecoverableCall, type TurnEvent } from "../turn/events";
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
  return ["turn_completed", "turn_failed", "rewound"].includes(event.type);
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
  return replayWorkerMessages(activeEvents(events));
}

export interface SessionReplay {
  events: TurnEvent[];
  activeEvents: TurnEvent[];
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
  const active = activeEvents(allEvents);
  return {
    events: allEvents,
    activeEvents: active,
    nextTurnIndex: nextTurnIndexAfter(turnNumbers),
    loadErrors,
    unansweredCalls: findUnansweredCalls(active),
  };
}

export function foldSession(events: TurnEvent[]): Transcript {
  const turnTree = buildTurnTree(events);
  return foldTurnEvents(activeEvents(events, turnTree), { ...emptyTranscript(), turnTree });
}

export async function rehydrateSession(
  fs: FileStore,
  workspaceDir: string,
  sessionId: string
): Promise<RehydratedSession> {
  const metadata = await loadOrCreateMetadata(fs, workspaceDir, sessionId);
  const { events, nextTurnIndex, loadErrors, unansweredCalls } = await replaySession(
    fs,
    sessionDirFor(workspaceDir, sessionId)
  );
  return { metadata, ...foldSession(events), nextTurnIndex, loadErrors, unansweredCalls };
}

export async function rewindSession(
  fs: FileStore,
  sessionDir: string,
  head: TurnHead
): Promise<number> {
  const { turnNumbers } = await loadSessionTurns(fs, sessionDir, failOnTurnError);
  const turnIndex = nextTurnIndexAfter(turnNumbers);
  const event: TurnEvent = {
    type: "rewound",
    head,
    seq: 0,
    at: new Date().toISOString(),
    turnIndex,
    actor: USER_ACTOR,
  };
  const turnDir = turnDirFor(sessionDir, turnIndex);
  await fs.mkdir(turnDir);
  await appendSegmentEvents(fs, join(turnDir, segmentFileName(0, USER_ACTOR)), [event]);
  return turnIndex + 1;
}

export async function copyActivePath(
  fs: FileStore,
  fromDir: string,
  toDir: string,
  head: TurnHead
): Promise<number> {
  const { events } = await loadSessionTurns(fs, fromDir, failOnTurnError);
  const path = activePath(buildTurnTree(events), head);
  for (const [index, turn] of path.entries()) {
    const turnIndex = index + 1;
    const turnDir = turnDirFor(toDir, turnIndex);
    await fs.mkdir(turnDir);
    await appendSegmentEvents(
      fs,
      join(turnDir, segmentFileName(0, WORKER_ACTOR)),
      events.filter((e) => e.turnIndex === turn).map((e) => ({ ...e, turnIndex }))
    );
  }
  return path.length;
}
