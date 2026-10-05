import { describe, it, expect } from "bun:test";
import {
  createAskTools,
  createDecideTools,
  type ExitDecision,
} from "../src/core/governor/assumptionTools";
import { requiresToolCheck, shouldAskUser } from "../src/core/governor/assumptionRules";
import { GovernorInterceptor } from "../src/core/governor/interceptor";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import type { PromptAnswer, UserPrompt } from "../src/types/tools";
import { localGovernor, recordingContext } from "./helpers/turnContext";
import { assumption, parse } from "./helpers/governorFixtures";

const intentA = { id: "itnt_a", kind: "request" as const, description: "Summarize PR comments" };

describe("assumption rules", () => {
  it.each([
    [{}, false],
    [{ candidates: "countable" as const }, false],
    [{ candidates: "open" as const }, false],
    [{ candidates: "countable" as const, user_would_care: false }, false],
    [{ impact_cost: "high" as const }, true],
    [{ user_would_care: true }, true],
    [{ impact_cost: "high" as const, impact_category: "response_text" as const }, false],
    [{ impact_cost: "high" as const, resolver: "tool" as const }, false],
    [{ impact_cost: "high" as const, status: "resolved" as const }, false],
    [{ impact_cost: "high" as const, depends_on: "a0" }, false],
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
  it("ask_user asks every listed assumption in one prompt and refuses unlisted or repeated ids", async () => {
    const governor = localGovernor({
      intent_stack: [intentA],
      completed_intents: [],
      resolved_since_prompt: [],
      assumptions: [
        assumption("a1", "itnt_a", { text: "the PR is #4" }),
        assumption("a2", "itnt_a", { text: "the repo is main" }),
      ],
    });
    const prompts: UserPrompt[] = [];
    const answers = new Map<string, PromptAnswer>();
    const [askUser] = createAskTools(
      governor.dispatch,
      governor.state,
      new Set(["a1", "a2"]),
      async (prompt) => {
        prompts.push(prompt);
        return { a1: true, a2: "the repo is dev" };
      },
      answers
    );

    const result = parse(
      await askUser.invoke({
        questions: [
          { assumption_id: "a1", topic: "PR" },
          { assumption_id: "a2", topic: "Repo", options: ["dev"] },
          { assumption_id: "a3", topic: "Other" },
        ],
      })
    );
    expect(result.a1.status).toBe("resolved");
    expect(result.a2).toEqual({ status: "changed", answer: "the repo is dev" });
    expect(result.a3.status).toBe("refused");
    expect(prompts).toEqual([
      {
        kind: "assumptions",
        label: "Confirm 2 assumptions",
        questions: [
          { id: "a1", topic: "PR", label: "We assumed: the PR is #4", options: [] },
          { id: "a2", topic: "Repo", label: "We assumed: the repo is main", options: ["dev"] },
        ],
      },
    ]);
    expect(answers.get("a2")).toBe("the repo is dev");
    expect(governor.state().assumptions.map((a) => a.status)).toEqual(["resolved", "open"]);

    const repeated = parse(
      await askUser.invoke({ questions: [{ assumption_id: "a1", topic: "PR" }] })
    );
    expect(repeated.a1.status).toBe("refused");
    expect(prompts).toHaveLength(1);
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
    await byName("returnToWorkerWithUnmetIntent").invoke({
      intent_id: "itnt_a",
      why: "nothing done",
    });

    expect(governor.state().completed_intents.map((i) => i.id)).toEqual(["itnt_a"]);
    expect(decisions).toEqual([
      { kind: "approve" },
      { kind: "unmet_intent", why: "nothing done", intentId: "itnt_a" },
    ]);
  });

  it("onAgentFinish automatically permits finish if intent stack is empty", async () => {
    const governor = new GovernorInterceptor({ runtime: createMemoryRuntime() });
    const verdict = await governor.onAgentFinish([], recordingContext().context);
    expect(verdict.allowFinish).toBe(true);
  });
});
