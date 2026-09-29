import { parseShellResult } from "../tools/shellResult";
import type { TurnEvent } from "./events";
import { TOOL_SOURCE, USER_SOURCE, WORKER_SOURCE } from "./waiting";

export interface ProfileSpan {
  turnIndex: number;
  on: string;
  source: string;
  hook?: string;
  startMs: number;
  durationMs: number;
}

interface OpenSpan {
  on: string;
  source: string;
  hook?: string;
  startMs: number;
}

export interface ProfileTurn {
  turnIndex: number;
  startMs: number;
  endMs?: number;
  hasWaiting: boolean;
}

export interface Profile {
  spans: ProfileSpan[];
  turns: ProfileTurn[];
  open?: OpenSpan;
  resume?: OpenSpan;
}

export const EMPTY_PROFILE: Profile = { spans: [], turns: [] };

function closeOpen(profile: Profile, turnIndex: number, atMs: number): Profile {
  const { open } = profile;
  if (!open) return profile;
  const span = { turnIndex, ...open, durationMs: Math.max(0, atMs - open.startMs) };
  return { ...profile, spans: [...profile.spans, span], open: undefined };
}

function addSpan(profile: Profile, span: ProfileSpan): Profile {
  return { ...profile, spans: [...profile.spans, span] };
}

function updateTurn(
  profile: Profile,
  turnIndex: number,
  update: (turn: ProfileTurn) => ProfileTurn
): Profile {
  return {
    ...profile,
    turns: profile.turns.map((turn) => (turn.turnIndex === turnIndex ? update(turn) : turn)),
  };
}

function isLegacyTurn(profile: Profile, turnIndex: number): boolean {
  return !profile.turns.find((turn) => turn.turnIndex === turnIndex)?.hasWaiting;
}

export function applyProfileEvent(profile: Profile, event: TurnEvent): Profile {
  const atMs = Date.parse(event.at);
  const { turnIndex } = event;
  switch (event.type) {
    case "turn_started": {
      const turns = profile.turns.filter((turn) => turn.turnIndex !== turnIndex);
      return {
        ...profile,
        turns: [...turns, { turnIndex, startMs: atMs, hasWaiting: false }],
        open: undefined,
        resume: undefined,
      };
    }
    case "waiting": {
      const closed = updateTurn(closeOpen(profile, turnIndex, atMs), turnIndex, (turn) => ({
        ...turn,
        hasWaiting: true,
      }));
      return {
        ...closed,
        open: { on: event.on, source: event.source ?? "other", hook: event.hook, startMs: atMs },
      };
    }
    case "prompt_requested": {
      const closed = closeOpen(profile, turnIndex, atMs);
      return {
        ...closed,
        open: { on: event.prompt.label, source: USER_SOURCE, startMs: atMs },
        resume: profile.open,
      };
    }
    case "prompt_answered": {
      const closed = closeOpen(profile, turnIndex, atMs);
      return {
        ...closed,
        open: profile.resume && { ...profile.resume, startMs: atMs },
        resume: undefined,
      };
    }
    case "model_step": {
      if (profile.open?.source === WORKER_SOURCE) return closeOpen(profile, turnIndex, atMs);
      if (!isLegacyTurn(profile, turnIndex)) return profile;
      return addSpan(profile, {
        turnIndex,
        on: "Worker model",
        source: WORKER_SOURCE,
        startMs: atMs - event.durationMs,
        durationMs: event.durationMs,
      });
    }
    case "tool_result": {
      if (profile.open?.source === TOOL_SOURCE) return closeOpen(profile, turnIndex, atMs);
      const { durationMs } = parseShellResult(event.content);
      if (durationMs === undefined || !isLegacyTurn(profile, turnIndex)) return profile;
      return addSpan(profile, {
        turnIndex,
        on: `Running ${event.name}`,
        source: TOOL_SOURCE,
        startMs: atMs - durationMs,
        durationMs,
      });
    }
    case "governor_fork": {
      return profile.open?.source === event.interceptor
        ? closeOpen(profile, turnIndex, atMs)
        : profile;
    }
    case "turn_completed":
    case "turn_failed": {
      const closed = closeOpen(profile, turnIndex, atMs);
      return {
        ...updateTurn(closed, turnIndex, (turn) => ({ ...turn, endMs: atMs })),
        resume: undefined,
      };
    }
    default: {
      return profile;
    }
  }
}
