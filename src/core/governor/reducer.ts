import { nanoid } from "nanoid";
import {
  intentKindSchema,
  type GovernorAction,
  type GovernorState,
  type IntentKind,
  type UserIntent,
} from "./types";
import {
  addFalseCompletion,
  declareNoFalseCompletions,
  resolveFalseCompletion,
} from "./falseCompletionReducer";

export interface GovernorActionOutcome {
  state: GovernorState;
  result: Record<string, unknown>;
}

export const EMPTY_GOVERNOR_STATE: GovernorState = {
  intent_stack: [],
  completed_intents: [],
  false_completions: [],
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
    },
    result: {
      status: "resolved",
      id: completed.id,
      description: completed.description,
      message: `Intent '${completed.id}' marked as satisfied and moved to history.`,
    },
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
        what_changed: action.what_changed,
      });
    }
    case "add_false_completion": {
      return addFalseCompletion(state, action.falseCompletion);
    }
    case "no_false_completions": {
      return declareNoFalseCompletions(state, action.intent_id);
    }
    case "resolve_false_completion": {
      return resolveFalseCompletion(
        state,
        action.id,
        action.resolution,
        action.evidence,
        action.reason,
        action.still_assumed
      );
    }
    case "pop_intent": {
      return popIntent(state, action.id);
    }
    case "resolve_intent": {
      return resolveIntent(state, action.id);
    }
  }
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

export function governorActionFromCall(
  name: string,
  args: Record<string, unknown>
): GovernorAction | null {
  switch (name) {
    case "push_intent": {
      const kind = intentKindSchema.safeParse(args.kind);
      return {
        type: "push_intent",
        intent: {
          id: stringArg(args, "id") || `itnt_${nanoid()}`,
          kind: kind.success ? kind.data : "other",
          description: stringArg(args, "description") ?? "",
          completed_when: stringArg(args, "completed_when") ?? null,
          changelog: [],
        },
      };
    }
    case "pop_intent": {
      return { type: "pop_intent", id: stringArg(args, "id") };
    }
    case "resolve_intent": {
      const id = stringArg(args, "id");
      return id === undefined ? null : { type: "resolve_intent", id };
    }
    default: {
      return null;
    }
  }
}
