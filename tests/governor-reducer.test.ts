import { describe, it, expect } from "bun:test";
import { applyGovernorAction, EMPTY_GOVERNOR_STATE } from "../src/core/governor/reducer";
import type { GovernorState, UserIntent } from "../src/core/governor/types";
import { assumption } from "./helpers/governorFixtures";

const intent = (id: string, kind: UserIntent["kind"] = "request"): UserIntent => ({
  id,
  kind,
  description: id,
  completed_when: null,
  changelog: [],
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
    applyGovernorAction(state, { type: "resolve_intent", id: "a" });
    applyGovernorAction(state, { type: "pop_intent" });
    expect(state).toEqual(frozen);
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

  it("resolve_intent records the intent as resolved since the prompt; begin_prompt clears it", () => {
    const first = applyGovernorAction(withStack(intent("a"), intent("b")), {
      type: "resolve_intent",
      id: "a",
    }).state;
    const second = applyGovernorAction(first, { type: "resolve_intent", id: "b" }).state;
    expect(second.resolved_since_prompt.map((i) => i.id)).toEqual(["a", "b"]);
    const cleared = applyGovernorAction(second, { type: "begin_prompt" }).state;
    expect(cleared.resolved_since_prompt).toEqual([]);
    expect(cleared.completed_intents.map((i) => i.id)).toEqual(["a", "b"]);
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
});

describe("governor reducer: update_intent", () => {
  it("changes only the provided fields and keeps id and assumptions", () => {
    const state: GovernorState = {
      ...withStack(intent("a")),
      assumptions: [assumption("r1", "a")],
    };
    const { state: next, result } = applyGovernorAction(state, {
      type: "update_intent",
      id: "a",
      description: "revised",
      what_changed: "renamed",
    });
    expect(result.status).toBe("updated");
    expect(next.intent_stack[0]).toEqual({
      id: "a",
      kind: "request",
      description: "revised",
      completed_when: null,
      changelog: ["renamed"],
    });
    expect(next.assumptions).toEqual(state.assumptions);

    const kindOnly = applyGovernorAction(next, {
      type: "update_intent",
      id: "a",
      kind: "question",
    });
    expect(kindOnly.state.intent_stack[0]).toMatchObject({
      kind: "question",
      description: "revised",
    });
  });

  it("returns not_found for an unknown id", () => {
    const state = withStack(intent("a"));
    const { state: next, result } = applyGovernorAction(state, {
      type: "update_intent",
      id: "missing",
      description: "x",
    });
    expect(result.status).toBe("not_found");
    expect(next).toBe(state);
  });
});

describe("governor reducer: assumptions", () => {
  it("records an assumption for an active intent", () => {
    const { state, result } = applyGovernorAction(withStack(intent("a")), {
      type: "record_assumption",
      assumption: assumption("r1", "a"),
    });
    expect(result.status).toBe("recorded");
    expect(state.assumptions).toEqual([assumption("r1", "a")]);
  });

  it("rejects an assumption for an intent not on the active stack", () => {
    const state = withStack(intent("a"));
    const outcome = applyGovernorAction(state, {
      type: "record_assumption",
      assumption: assumption("r1", "gone"),
    });
    expect(outcome.result.status).toBe("not_found");
    expect(outcome.state).toBe(state);
  });

  it("resolves with evidence, then reports already_resolved and not_found", () => {
    const state = { ...withStack(intent("a")), assumptions: [assumption("r1", "a")] };
    const resolved = applyGovernorAction(state, {
      type: "resolve_assumption",
      id: "r1",
      evidence: "user confirmed",
    });
    expect(resolved.state.assumptions[0]).toMatchObject({
      status: "resolved",
      evidence: "user confirmed",
    });
    const again = applyGovernorAction(resolved.state, {
      type: "resolve_assumption",
      id: "r1",
      evidence: "x",
    });
    expect(again.result.status).toBe("already_resolved");
    expect(again.state).toBe(resolved.state);
    const missing = applyGovernorAction(state, {
      type: "resolve_assumption",
      id: "nope",
      evidence: "x",
    });
    expect(missing.result.status).toBe("not_found");
  });

  it("clear_assumptions empties the list", () => {
    const state = { ...withStack(intent("a")), assumptions: [assumption("r1", "a")] };
    expect(applyGovernorAction(state, { type: "clear_assumptions" }).state.assumptions).toEqual([]);
  });
});
