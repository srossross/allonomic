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

function hasSpanSince(profile: Profile, source: string, startMs: number): boolean {
  return profile.spans.some((span) => span.source === source && span.startMs >= startMs);
}

export function applyProfileEvent(profile: Profile, event: TurnEvent): Profile {
  const atMs = Date.parse(event.at);
  const { turnIndex } = event;
  switch (event.type) {
    case "turn_started": {
      const turns = profile.turns.filter((turn) => turn.turnIndex !== turnIndex);
      return {
        ...profile,
        turns: [...turns, { turnIndex, startMs: atMs }],
        open: undefined,
        resume: undefined,
      };
    }
    case "waiting": {
      const closed = closeOpen(profile, turnIndex, atMs);
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
      return profile.open?.source === WORKER_SOURCE ? closeOpen(profile, turnIndex, atMs) : profile;
    }
    case "tool_result": {
      return profile.open?.source === TOOL_SOURCE ? closeOpen(profile, turnIndex, atMs) : profile;
    }
    case "governor_fork": {
      return profile.open?.source === event.interceptor
        ? closeOpen(profile, turnIndex, atMs)
        : profile;
    }
    case "interceptor_passed": {
      const startMs = atMs - event.durationMs;
      if (hasSpanSince(profile, event.interceptor, startMs)) return profile;
      return addSpan(profile, {
        turnIndex,
        on: event.interceptor,
        source: event.interceptor,
        hook: event.phase,
        startMs,
        durationMs: event.durationMs,
      });
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
