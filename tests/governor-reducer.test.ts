import { describe, it, expect } from "bun:test";
import {
  applyGovernorAction,
  EMPTY_GOVERNOR_STATE,
  governorActionFromCall,
} from "../src/core/governor/reducer";
import type { GovernorState, UserIntent, FalseCompletion } from "../src/core/governor/types";

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
      intent: { id: "i1", kind: "question", description: "d", completed_when: null, changelog: [] },
    });
    const fallback = governorActionFromCall("push_intent", { kind: "bogus" });
    expect(fallback).toMatchObject({ intent: { kind: "other" } });
    expect(governorActionFromCall("resolve_intent", {})).toBeNull();
    expect(governorActionFromCall("finish", {})).toBeNull();
  });
});

const falseCompletion = (id: string, intent_id: string): FalseCompletion => ({
  id,
  intent_id,
  summary: id,
  relies_on: "r",
  completes_as: "c",
  false_because: "f",
  detect_by: null,
  evidence: null,
  resolution: null,
  resolution_reason: null,
  still_assumed: null,
  directive: null,
});

const evidence = { source: "src/a.ts", quote: "const a = 1;" };

describe("governor reducer: update_intent", () => {
  it("changes only the provided fields and keeps id and falseCompletions", () => {
    const state: GovernorState = {
      ...withStack(intent("a")),
      false_completions: [falseCompletion("r1", "a")],
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
    expect(next.false_completions).toEqual(state.false_completions);

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

describe("governor reducer: false completions", () => {
  it("adds a false completion to an active intent", () => {
    const { state, result } = applyGovernorAction(withStack(intent("a")), {
      type: "add_false_completion",
      falseCompletion: falseCompletion("r1", "a"),
    });
    expect(result.status).toBe("created");
    expect(state.false_completions).toEqual([falseCompletion("r1", "a")]);
  });

  it("rejects a false completion for an intent not on the active stack", () => {
    const state = { ...withStack(intent("a")), completed_intents: [intent("done")] };
    for (const intentId of ["missing", "done"]) {
      const { state: next, result } = applyGovernorAction(state, {
        type: "add_false_completion",
        falseCompletion: falseCompletion("r1", intentId),
      });
      expect(result.status).toBe("not_found");
      expect(next).toBe(state);
    }
  });

  it("requires evidence for ruled_out and clarified", () => {
    const state = { ...withStack(intent("a")), false_completions: [falseCompletion("r1", "a")] };
    for (const resolution of ["ruled_out", "clarified"] as const) {
      const rejected = applyGovernorAction(state, {
        type: "resolve_false_completion",
        id: "r1",
        resolution,
        reason: "no quote",
      });
      expect(rejected.result.status).toBe("error");
      expect(rejected.state).toBe(state);

      const { state: next, result } = applyGovernorAction(state, {
        type: "resolve_false_completion",
        id: "r1",
        resolution,
        evidence,
        still_assumed: "nothing",
      });
      expect(result.status).toBe("resolved");
      expect(next.false_completions[0]).toMatchObject({
        resolution,
        evidence,
        resolution_reason: null,
        still_assumed: "nothing",
      });
    }
  });

  it("replays a ruled_out resolve saved without still_assumed", () => {
    const state = { ...withStack(intent("a")), false_completions: [falseCompletion("r1", "a")] };
    const { state: next, result } = applyGovernorAction(state, {
      type: "resolve_false_completion",
      id: "r1",
      resolution: "ruled_out",
      evidence,
    });
    expect(result.status).toBe("resolved");
    expect(next.false_completions[0].still_assumed).toBeNull();
  });

  it("requires a reason for invalid and superseded", () => {
    const state = { ...withStack(intent("a")), false_completions: [falseCompletion("r1", "a")] };
    for (const resolution of ["invalid", "superseded"] as const) {
      const rejected = applyGovernorAction(state, {
        type: "resolve_false_completion",
        id: "r1",
        resolution,
        evidence,
      });
      expect(rejected.result.status).toBe("error");
      expect(rejected.state).toBe(state);

      const { state: next, result } = applyGovernorAction(state, {
        type: "resolve_false_completion",
        id: "r1",
        resolution,
        reason: "intent changed",
      });
      expect(result.status).toBe("resolved");
      expect(next.false_completions[0]).toMatchObject({
        resolution,
        resolution_reason: "intent changed",
      });
    }
  });

  it("returns not_found and already_resolved without changing state", () => {
    const state = {
      ...withStack(intent("a")),
      false_completions: [
        { ...falseCompletion("r1", "a"), resolution: "invalid" as const, resolution_reason: "x" },
      ],
    };
    const missing = applyGovernorAction(state, {
      type: "resolve_false_completion",
      id: "nope",
      resolution: "invalid",
      reason: "x",
    });
    expect(missing.result.status).toBe("not_found");
    expect(missing.state).toBe(state);

    const again = applyGovernorAction(state, {
      type: "resolve_false_completion",
      id: "r1",
      resolution: "superseded",
      reason: "y",
    });
    expect(again.result.status).toBe("already_resolved");
    expect(again.state).toBe(state);
  });
});
