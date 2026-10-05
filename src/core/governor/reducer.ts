import type {
  Assumption,
  Classification,
  GovernorAction,
  GovernorState,
  IntentKind,
  UserIntent,
} from "./types";

export interface GovernorActionOutcome {
  state: GovernorState;
  result: Record<string, unknown>;
}

export const EMPTY_GOVERNOR_STATE: GovernorState = {
  intent_stack: [],
  completed_intents: [],
  assumptions: [],
  resolved_since_prompt: [],
};

function replaceIntent(stack: UserIntent[], index: number, next: UserIntent): UserIntent[] {
  return stack.map((intent, index_) => (index_ === index ? next : intent));
}

function pushIntent(state: GovernorState, intent: UserIntent): GovernorActionOutcome {
  return {
    state: { ...state, intent_stack: [...state.intent_stack, intent] },
    result: {
      status: "created",
      intent,
      message: `Created intent '${intent.id}' (${intent.kind}): "${intent.description}"`,
    },
  };
}

function updateIntent(
  state: GovernorState,
  id: string,
  changes: {
    description?: string;
    kind?: IntentKind;
    completed_when?: string;
    overstep?: string;
    specificity?: UserIntent["specificity"];
    what_changed?: string;
  }
): GovernorActionOutcome {
  const index = state.intent_stack.findIndex((intent) => intent.id === id);
  if (index === -1) {
    return {
      state,
      result: { status: "not_found", message: `Intent with id '${id}' not found.` },
    };
  }
  const current = state.intent_stack[index];
  const updated: UserIntent = {
    ...current,
    description: changes.description ?? current.description,
    kind: changes.kind ?? current.kind,
    completed_when: changes.completed_when ?? current.completed_when,
    overstep: changes.overstep ?? current.overstep,
    specificity: changes.specificity ?? current.specificity,
    changelog: changes.what_changed
      ? [...current.changelog, changes.what_changed]
      : current.changelog,
  };
  return {
    state: { ...state, intent_stack: replaceIntent(state.intent_stack, index, updated) },
    result: { status: "updated", intent: updated },
  };
}

function popIntent(state: GovernorState, id: string | undefined): GovernorActionOutcome {
  const index =
    id === undefined
      ? state.intent_stack.length - 1
      : state.intent_stack.findIndex((intent) => intent.id === id);
  if (index === -1) {
    return {
      state,
      result:
        id === undefined
          ? { status: "empty", message: "Intent stack is already empty." }
          : { status: "not_found", message: `Intent with id '${id}' not found.` },
    };
  }
  const removed = state.intent_stack[index];
  return {
    state: { ...state, intent_stack: state.intent_stack.filter((_, index_) => index_ !== index) },
    result: { status: "popped", id: removed.id, description: removed.description },
  };
}

function resolveIntent(state: GovernorState, id: string): GovernorActionOutcome {
  const completed = state.intent_stack.find((intent) => intent.id === id);
  if (!completed) {
    return {
      state,
      result: {
        status: "not_found",
        message: `Intent with id '${id}' not found on the active stack.`,
      },
    };
  }
  return {
    state: {
      ...state,
      intent_stack: state.intent_stack.filter((intent) => intent !== completed),
      completed_intents: [...state.completed_intents, completed],
      resolved_since_prompt: [...state.resolved_since_prompt, completed],
    },
    result: {
      status: "resolved",
      id: completed.id,
      description: completed.description,
      message: `Intent '${completed.id}' marked as satisfied and moved to history.`,
    },
  };
}

function recordAssumption(state: GovernorState, assumption: Assumption): GovernorActionOutcome {
  if (state.intent_stack.every((intent) => intent.id !== assumption.intent_id)) {
    return {
      state,
      result: {
        status: "not_found",
        message: `Intent '${assumption.intent_id}' is not on the active stack.`,
      },
    };
  }
  return {
    state: { ...state, assumptions: [...state.assumptions, assumption] },
    result: { status: "recorded", id: assumption.id },
  };
}

function classifyAssumption(
  state: GovernorState,
  id: string,
  classification: Classification
): GovernorActionOutcome {
  const assumption = state.assumptions.find((a) => a.id === id);
  if (!assumption) {
    return { state, result: { status: "not_found", message: `Assumption '${id}' not found.` } };
  }
  if (assumption.status !== "open") {
    return { state, result: { status: "refused", message: `Assumption '${id}' is not open.` } };
  }
  const classified: Assumption = { ...assumption, ...classification };
  return {
    state: {
      ...state,
      assumptions: state.assumptions.map((a) => (a.id === id ? classified : a)),
    },
    result: { status: "classified", id },
  };
}

function dropAssumption(state: GovernorState, id: string): GovernorActionOutcome {
  if (state.assumptions.every((a) => a.id !== id)) {
    return { state, result: { status: "not_found", message: `Assumption '${id}' not found.` } };
  }
  return {
    state: { ...state, assumptions: state.assumptions.filter((a) => a.id !== id) },
    result: { status: "dropped", id },
  };
}

function resolveAssumption(
  state: GovernorState,
  id: string,
  evidence: string
): GovernorActionOutcome {
  const assumption = state.assumptions.find((a) => a.id === id);
  if (!assumption) {
    return { state, result: { status: "not_found", message: `Assumption '${id}' not found.` } };
  }
  if (assumption.status === "resolved") {
    return {
      state,
      result: { status: "already_resolved", message: `Assumption '${id}' is already resolved.` },
    };
  }
  const resolved: Assumption = { ...assumption, status: "resolved", evidence };
  return {
    state: {
      ...state,
      assumptions: state.assumptions.map((a) => (a.id === id ? resolved : a)),
    },
    result: { status: "resolved", id },
  };
}

export function applyGovernorAction(
  state: GovernorState,
  action: GovernorAction
): GovernorActionOutcome {
  switch (action.type) {
    case "push_intent": {
      return pushIntent(state, action.intent);
    }
    case "update_intent": {
      return updateIntent(state, action.id, {
        description: action.description,
        kind: action.kind,
        completed_when: action.completed_when,
        overstep: action.overstep,
        specificity: action.specificity,
        what_changed: action.what_changed,
      });
    }
    case "record_assumption": {
      return recordAssumption(state, action.assumption);
    }
    case "classify_assumption": {
      return classifyAssumption(state, action.id, action.classification);
    }
    case "drop_assumption": {
      return dropAssumption(state, action.id);
    }
    case "clear_assumptions": {
      return { state: { ...state, assumptions: [] }, result: { status: "cleared" } };
    }
    case "resolve_assumption": {
      return resolveAssumption(state, action.id, action.evidence);
    }
    case "pop_intent": {
      return popIntent(state, action.id);
    }
    case "resolve_intent": {
      return resolveIntent(state, action.id);
    }
    case "begin_prompt": {
      return { state: { ...state, resolved_since_prompt: [] }, result: { status: "begun" } };
    }
  }
}
