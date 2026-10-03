import { describe, it, expect } from "bun:test";
import {
  createAskTools,
  createDecideTools,
  type ExitDecision,
} from "../src/core/governor/assumptionTools";
import { requiresToolCheck, shouldAskUser } from "../src/core/governor/assumptionRules";
import { GovernorInterceptor } from "../src/core/governor/interceptor";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import type { UserPromptValue } from "../src/types/tools";
import { localGovernor, recordingContext } from "./helpers/turnContext";
import { assumption, parse } from "./helpers/governorFixtures";

const intentA = { id: "itnt_a", kind: "request" as const, description: "Summarize PR comments" };

describe("assumption rules", () => {
  it.each([
    [{}, false],
    [{ candidates: "countable" as const }, true],
    [{ candidates: "open" as const }, true],
    [{ impact_cost: "high" as const }, true],
    [{ user_would_care: true }, true],
    [{ candidates: "countable" as const, impact_category: "response_text" as const }, false],
    [{ candidates: "countable" as const, resolver: "tool" as const }, false],
    [{ candidates: "countable" as const, status: "resolved" as const }, false],
    [{ candidates: "countable" as const, depends_on: "a0" }, false],
  ])("shouldAskUser(%o) is %p", (overrides, expected) => {
    expect(shouldAskUser(assumption("a1", "i", overrides))).toBe(expected);
  });

  it.each([
    [{ resolver: "tool" as const }, true],
    [{ resolver: "tool" as const, impact_category: "response_text" as const }, false],
    [{ resolver: "tool" as const, impact_category: "wasted_work" as const }, true],
    [{ resolver: "tool" as const, status: "resolved" as const }, false],
    [{ resolver: "user" as const }, false],
  ])("requiresToolCheck(%o) is %p", (overrides, expected) => {
    expect(requiresToolCheck(assumption("a1", "i", overrides))).toBe(expected);
  });
});

describe("assumption tools", () => {
  it("ask_user resolves a confirmed assumption and refuses unlisted or repeated ids", async () => {
    const governor = localGovernor({
      intent_stack: [intentA],
      completed_intents: [],
      resolved_since_prompt: [],
      assumptions: [assumption("a1", "itnt_a", { text: "the PR is #4" })],
    });
    const labels: string[] = [];
    const answers = new Map<string, UserPromptValue>();
    const [askUser] = createAskTools(
      governor.dispatch,
      governor.state,
      new Set(["a1"]),
      async (prompt) => {
        labels.push(prompt.label);
        return true;
      },
      answers
    );

    expect(parse(await askUser.invoke({ assumption_id: "a2" })).status).toBe("refused");
    expect(parse(await askUser.invoke({ assumption_id: "a1" })).status).toBe("resolved");
    expect(parse(await askUser.invoke({ assumption_id: "a1" })).status).toBe("refused");
    expect(labels).toEqual(["We assumed: the PR is #4"]);
    expect(governor.state().assumptions[0]).toMatchObject({
      status: "resolved",
      evidence: "user confirmed",
    });
  });

  it("ask_user keeps a changed assumption open and records the answer", async () => {
    const governor = localGovernor({
      intent_stack: [intentA],
      completed_intents: [],
      resolved_since_prompt: [],
      assumptions: [assumption("a1", "itnt_a")],
    });
    const answers = new Map<string, UserPromptValue>();
    const [askUser] = createAskTools(
      governor.dispatch,
      governor.state,
      new Set(["a1"]),
      async () => "PR #7",
      answers
    );

    expect(parse(await askUser.invoke({ assumption_id: "a1", options: ["PR #7"] }))).toEqual({
      status: "changed",
      answer: "PR #7",
    });
    expect(answers.get("a1")).toBe("PR #7");
    expect(governor.state().assumptions[0].status).toBe("open");
  });

  it("decide tools resolve intents and signal the first decision only", async () => {
    const governor = localGovernor({
      intent_stack: [intentA],
      completed_intents: [],
      resolved_since_prompt: [],
      assumptions: [],
    });
    const decisions: ExitDecision[] = [];
    const tools = createDecideTools(governor.dispatch, (decision) => {
      decisions.push(decision);
    });
    const byName = (name: string) => tools.find((t) => t.name === name)!;

    expect(parse(await byName("resolve_intent").invoke({ id: "itnt_a" })).status).toBe("resolved");
    await byName("atLeastOneIntentWasSatisfied").invoke({});
    await byName("returnToWorkerWithUnmetIntent").invoke({ why: "nothing done" });

    expect(governor.state().completed_intents.map((i) => i.id)).toEqual(["itnt_a"]);
    expect(decisions).toEqual([{ kind: "approve" }, { kind: "unmet_intent", why: "nothing done" }]);
  });

  it("onAgentFinish automatically permits finish if intent stack is empty", async () => {
    const governor = new GovernorInterceptor({ runtime: createMemoryRuntime() });
    const verdict = await governor.onAgentFinish([], recordingContext().context);
    expect(verdict.allowFinish).toBe(true);
  });
});
