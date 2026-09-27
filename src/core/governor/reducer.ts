import { nanoid } from "nanoid";
import {
  intentKindSchema,
  type GovernorAction,
  type GovernorState,
  type UserIntent,
} from "./types";

export interface GovernorActionOutcome {
  state: GovernorState;
  result: Record<string, unknown>;
}

export const EMPTY_GOVERNOR_STATE: GovernorState = {
  intent_stack: [],
  completed_intents: [],
  global_constraints: [],
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

function addConstraint(
  state: GovernorState,
  constraint: string,
  target: string
): GovernorActionOutcome {
  const targetIndex =
    target === "global" ? -1 : state.intent_stack.findIndex((intent) => intent.id === target);
  const index =
    target !== "global" && targetIndex === -1 ? state.intent_stack.length - 1 : targetIndex;
  if (index === -1) {
    return {
      state: { ...state, global_constraints: [...state.global_constraints, constraint] },
      result: { status: "added", target: "global", constraint },
    };
  }
  const intent = state.intent_stack[index];
  return {
    state: {
      ...state,
      intent_stack: replaceIntent(state.intent_stack, index, {
        ...intent,
        constraints: [...intent.constraints, constraint],
      }),
    },
    result: { status: "added", target: intent.id, constraint },
  };
}

function removeConstraint(
  state: GovernorState,
  constraint: string,
  target: string
): GovernorActionOutcome {
  if (target === "global") {
    return {
      state: {
        ...state,
        global_constraints: state.global_constraints.filter((c) => c !== constraint),
      },
      result: { status: "removed", target: "global", constraint },
    };
  }
  const index = state.intent_stack.findIndex((intent) => intent.id === target);
  if (index === -1) {
    return { state, result: { status: "not_found", message: `Target '${target}' not found.` } };
  }
  const intent = state.intent_stack[index];
  return {
    state: {
      ...state,
      intent_stack: replaceIntent(state.intent_stack, index, {
        ...intent,
        constraints: intent.constraints.filter((c) => c !== constraint),
      }),
    },
    result: { status: "removed", target, constraint },
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
    case "pop_intent": {
      return popIntent(state, action.id);
    }
    case "add_constraint": {
      return addConstraint(state, action.constraint, action.target);
    }
    case "remove_constraint": {
      return removeConstraint(state, action.constraint, action.target);
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
          id: stringArg(args, "id") ?? `itnt_${nanoid()}`,
          kind: kind.success ? kind.data : "other",
          description: stringArg(args, "description") ?? "",
          constraints: Array.isArray(args.constraints) ? args.constraints.map(String) : [],
        },
      };
    }
    case "pop_intent": {
      return { type: "pop_intent", id: stringArg(args, "id") };
    }
    case "add_constraint":
    case "remove_constraint": {
      return {
        type: name,
        constraint: stringArg(args, "constraint") ?? "",
        target: stringArg(args, "target") ?? "global",
      };
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
