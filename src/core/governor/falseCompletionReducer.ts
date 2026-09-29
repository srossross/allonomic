import {
  EVIDENCE_RESOLUTIONS,
  type Evidence,
  type GovernorState,
  type FalseCompletionResolution,
  type FalseCompletion,
} from "./types";
import type { GovernorActionOutcome } from "./reducer";

export function declareNoFalseCompletions(
  state: GovernorState,
  intentId: string
): GovernorActionOutcome {
  const isActive = state.intent_stack.some((intent) => intent.id === intentId);
  return {
    state,
    result: isActive
      ? { status: "acknowledged", intent_id: intentId }
      : {
          status: "not_found",
          message: `Intent with id '${intentId}' not found on the active stack.`,
        },
  };
}

export function addFalseCompletion(
  state: GovernorState,
  falseCompletion: FalseCompletion
): GovernorActionOutcome {
  if (state.intent_stack.every((intent) => intent.id !== falseCompletion.intent_id)) {
    return {
      state,
      result: {
        status: "not_found",
        message: `Intent with id '${falseCompletion.intent_id}' not found on the active stack.`,
      },
    };
  }
  return {
    state: { ...state, false_completions: [...state.false_completions, falseCompletion] },
    result: { status: "created", id: falseCompletion.id, summary: falseCompletion.summary },
  };
}

export function resolveFalseCompletion(
  state: GovernorState,
  id: string,
  resolution: FalseCompletionResolution,
  evidence: Evidence | undefined,
  reason: string | undefined,
  stillAssumed: string | undefined
): GovernorActionOutcome {
  const falseCompletion = state.false_completions.find((r) => r.id === id);
  if (!falseCompletion) {
    return {
      state,
      result: { status: "not_found", message: `False completion with id '${id}' not found.` },
    };
  }
  if (falseCompletion.resolution !== null) {
    return {
      state,
      result: {
        status: "already_resolved",
        message: `False completion '${id}' is already resolved as '${falseCompletion.resolution}'.`,
      },
    };
  }
  const needsEvidence = EVIDENCE_RESOLUTIONS.has(resolution);
  if (needsEvidence && !evidence) {
    return {
      state,
      result: { status: "error", message: `Resolution '${resolution}' requires evidence.` },
    };
  }
  if (!needsEvidence && !reason) {
    return {
      state,
      result: { status: "error", message: `Resolution '${resolution}' requires a reason.` },
    };
  }
  const resolved: FalseCompletion = {
    ...falseCompletion,
    evidence: evidence ?? falseCompletion.evidence,
    resolution,
    resolution_reason: reason ?? null,
    still_assumed: stillAssumed ?? null,
  };
  return {
    state: {
      ...state,
      false_completions: state.false_completions.map((r) => (r === falseCompletion ? resolved : r)),
    },
    result: { status: "resolved", id, resolution },
  };
}
