import { describe, it, expect } from "bun:test";
import {
  applyGovernorAction,
  EMPTY_GOVERNOR_STATE,
  governorActionFromCall,
} from "../src/core/governor/reducer";
import type { GovernorState, UserIntent } from "../src/core/governor/types";

const intent = (id: string, kind: UserIntent["kind"] = "request"): UserIntent => ({
  id,
  kind,
  description: id,
  constraints: [],
});

const withStack = (...intents: UserIntent[]): GovernorState => ({
  ...EMPTY_GOVERNOR_STATE,
  intent_stack: intents,
});

describe("governor reducer", () => {
  it("never mutates the input state", () => {
    const state = withStack(intent("a"));
    const frozen = structuredClone(state);
    applyGovernorAction(state, { type: "push_intent", intent: intent("b") });
    applyGovernorAction(state, { type: "add_constraint", constraint: "c", target: "a" });
    applyGovernorAction(state, { type: "resolve_intent", id: "a" });
    applyGovernorAction(state, { type: "pop_intent" });
    expect(state).toEqual(frozen);
  });

  it("add_constraint falls back from an unknown target to the top intent, then to global", () => {
    const onTop = applyGovernorAction(withStack(intent("a"), intent("b")), {
      type: "add_constraint",
      constraint: "x",
      target: "missing",
    });
    expect(onTop.result).toEqual({ status: "added", target: "b", constraint: "x" });
    expect(onTop.state.intent_stack[1].constraints).toEqual(["x"]);

    const onGlobal = applyGovernorAction(EMPTY_GOVERNOR_STATE, {
      type: "add_constraint",
      constraint: "x",
      target: "missing",
    });
    expect(onGlobal.result).toEqual({ status: "added", target: "global", constraint: "x" });
    expect(onGlobal.state.global_constraints).toEqual(["x"]);
  });

  it("remove_constraint on an unknown target is a no-op", () => {
    const state = withStack(intent("a"));
    const outcome = applyGovernorAction(state, {
      type: "remove_constraint",
      constraint: "x",
      target: "missing",
    });
    expect(outcome.result.status).toBe("not_found");
    expect(outcome.state).toBe(state);
  });

  it("resolve_intent moves the intent to completed history", () => {
    const outcome = applyGovernorAction(withStack(intent("a"), intent("b")), {
      type: "resolve_intent",
      id: "a",
    });
    expect(outcome.result.status).toBe("resolved");
    expect(outcome.state.intent_stack.map((i) => i.id)).toEqual(["b"]);
    expect(outcome.state.completed_intents.map((i) => i.id)).toEqual(["a"]);
    expect(
      applyGovernorAction(outcome.state, { type: "resolve_intent", id: "a" }).result.status
    ).toBe("not_found");
  });

  it("pop_intent reports not_found and empty", () => {
    const single = withStack(intent("a"));
    expect(applyGovernorAction(single, { type: "pop_intent", id: "zz" }).result.status).toBe(
      "not_found"
    );
    expect(applyGovernorAction(EMPTY_GOVERNOR_STATE, { type: "pop_intent" }).result.status).toBe(
      "empty"
    );
  });

  it("maps legacy tool calls to actions", () => {
    expect(
      governorActionFromCall("push_intent", { id: "i1", kind: "question", description: "d" })
    ).toEqual({
      type: "push_intent",
      intent: { id: "i1", kind: "question", description: "d", constraints: [] },
    });
    const fallback = governorActionFromCall("push_intent", { kind: "bogus" });
    expect(fallback).toMatchObject({ intent: { kind: "other" } });
    expect(governorActionFromCall("add_constraint", { constraint: "c" })).toEqual({
      type: "add_constraint",
      constraint: "c",
      target: "global",
    });
    expect(governorActionFromCall("resolve_intent", {})).toBeNull();
    expect(governorActionFromCall("finish", {})).toBeNull();
  });
});
