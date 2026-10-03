import { describe, it, expect, beforeEach } from "bun:test";
import type { UserIntent } from "../src/core/governor/types";
import type { AskUser } from "../src/core/graph/types";
import type { GovernorInterceptor } from "../src/core/governor/interceptor";
import { recordingContext } from "./helpers/turnContext";
import {
  firstInputFor,
  passes,
  scriptedGovernor,
  stubPromptRuntime,
  texts,
  workerConversation as conversation,
  type MemoryRuntime,
} from "./helpers/governorForks";

const intentA: UserIntent = {
  id: "itnt_a",
  kind: "request",
  description: "Summarize PR comments",
  completed_when: null,
  overstep: null,
  specificity: "low",
  changelog: [],
};

const record = (overrides: Record<string, unknown> = {}) => ({
  name: "record_assumption",
  args: {
    intent_id: "itnt_a",
    text: "the PR is #4",
    resolver: "user",
    impact_category: "wrong_answer",
    user_would_care: false,
    candidates: "one",
    impact_cost: "low",
    ...overrides,
  },
});

const LIST = { text: "- [open] the PR is #4" };
const CLASSIFIED = { name: "finish_classify" };
const APPROVE = { name: "atLeastOneIntentWasSatisfied" };

const askFirst = (getGovernor: () => GovernorInterceptor) => ({
  name: "ask_user",
  args: () => ({ assumption_id: getGovernor().state.assumptions[0].id }),
});

describe("governor passes", () => {
  let runtime: MemoryRuntime;

  beforeEach(async () => {
    runtime = await stubPromptRuntime();
  });

  it("entry runs only the entry pass", async () => {
    const { context, events } = recordingContext();
    const { governor } = scriptedGovernor(runtime, [{ name: "finish" }], {
      initialState: { intent_stack: [intentA] },
    });

    await governor.onUserPrompt(conversation, context);

    expect(passes(events)).toEqual(["entry.md"]);
  });

  it("exit lists, classifies and decides when nothing needs asking, dropping response_text", async () => {
    const { context, events } = recordingContext();
    const { model, governor } = scriptedGovernor(
      runtime,
      [LIST, record(), record({ impact_category: "response_text" }), CLASSIFIED, APPROVE],
      { initialState: { intent_stack: [intentA] } }
    );

    const verdict = await governor.onAgentFinish(conversation, context);

    expect(verdict).toEqual({ allowFinish: true, feedback: undefined });
    expect(passes(events)).toEqual([
      "assumptions_list.md",
      "assumptions_classify.md",
      "assumptions_decide.md",
    ]);
    const classifyInput = texts(firstInputFor(model.inputs, "CLASSIFY"));
    expect(classifyInput.slice(0, 5)).toEqual([...texts(conversation), "LIST", LIST.text]);
    expect(governor.state.assumptions).toHaveLength(1);
  });

  it("asks flagged assumptions and approves when every answer is confirm", async () => {
    const asked: string[] = [];
    const askUser: AskUser = async (prompt) => {
      asked.push(prompt.label);
      return true;
    };
    const { context, events } = recordingContext("t1", 1, askUser);
    const { governor } = scriptedGovernor(
      runtime,
      [LIST, record({ candidates: "countable" }), CLASSIFIED, askFirst(() => governor), APPROVE],
      { initialState: { intent_stack: [intentA] } }
    );

    const verdict = await governor.onAgentFinish(conversation, context);

    expect(verdict.allowFinish).toBe(true);
    expect(asked).toEqual(["We assumed: the PR is #4"]);
    expect(passes(events)).toEqual([
      "assumptions_list.md",
      "assumptions_classify.md",
      "assumptions_ask.md",
      "assumptions_decide.md",
    ]);
  });

  it("a changed answer only allows returning to the worker, with the answer verbatim", async () => {
    const { context } = recordingContext("t1", 1, async () => "PR #7");
    const { governor } = scriptedGovernor(
      runtime,
      [
        LIST,
        record({ candidates: "countable" }),
        CLASSIFIED,
        askFirst(() => governor),
        APPROVE,
        { name: "returnToWorkerWithUnresolvedAssumptions", args: { why: "wrong PR" } },
      ],
      { initialState: { intent_stack: [intentA] } }
    );

    const verdict = await governor.onAgentFinish(conversation, context);

    expect(verdict.allowFinish).toBe(false);
    expect(verdict.feedback).toBe(
      "wrong PR\n\nUser answers:\n- We assumed: the PR is #4\n  User: PR #7"
    );
  });

  it("an open tool-resolvable assumption rejects before decide runs and keeps the intent active", async () => {
    const { context, events } = recordingContext();
    const { governor } = scriptedGovernor(
      runtime,
      [
        LIST,
        record({ resolver: "tool", text: "bot comments count" }),
        record({
          resolver: "tool",
          text: "inline threads were not needed",
          request: "Fetch the line-by-line review comments on PR #4.",
        }),
        CLASSIFIED,
        APPROVE,
      ],
      { initialState: { intent_stack: [intentA] } }
    );

    const verdict = await governor.onAgentFinish(conversation, context);

    expect(verdict).toEqual({
      allowFinish: false,
      feedback:
        'For "Summarize PR comments", you made the following assumptions that can be verified:\n  * Fetch the line-by-line review comments on PR #4.',
    });
    expect(governor.state.assumptions.map((a) => a.text)).toEqual([
      "inline threads were not needed",
    ]);
    expect(passes(events)).not.toContain("assumptions_decide.md");
    expect(governor.state.intent_stack).toEqual([intentA]);
  });

  it("intent-only mode runs just the decide pass", async () => {
    const { context, events } = recordingContext();
    const { governor } = scriptedGovernor(runtime, [APPROVE], {
      initialState: { intent_stack: [intentA] },
    });
    governor.setHasAssumptions(false);

    const verdict = await governor.onAgentFinish(conversation, context);

    expect(verdict.allowFinish).toBe(true);
    expect(passes(events)).toEqual(["assumptions_decide.md"]);
  });
});
