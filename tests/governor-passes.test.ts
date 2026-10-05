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
  args: { intent_id: "itnt_a", text: "the PR is #4", ...overrides },
});

const classify = (
  getGovernor: () => GovernorInterceptor,
  overrides: Record<string, unknown> = {},
  index = 0
) => ({
  name: "add_to_assumption",
  args: () => ({
    id: getGovernor().state.assumptions[index].id,
    resolver: "user",
    impact_category: "wrong_answer",
    user_would_care: false,
    candidates: "one",
    impact_cost: "low",
    ...overrides,
  }),
});

const LIST = { text: "- [open] the PR is #4" };
const RECORDED = { name: "finish_record" };
const APPROVE = { name: "atLeastOneIntentWasSatisfied" };

const askFirst = (getGovernor: () => GovernorInterceptor) => ({
  name: "ask_user",
  args: () => ({
    questions: [{ assumption_id: getGovernor().state.assumptions[0].id, topic: "PR" }],
  }),
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

  it("exit lists, records, classifies and decides when nothing needs asking, dropping response_text", async () => {
    const { context, events } = recordingContext();
    const { model, governor } = scriptedGovernor(
      runtime,
      [
        LIST,
        record(),
        record({ text: "the reply is short" }),
        RECORDED,
        classify(() => governor),
        classify(() => governor, { impact_category: "response_text" }, 1),
        APPROVE,
      ],
      { initialState: { intent_stack: [intentA] } }
    );

    const verdict = await governor.onAgentFinish(conversation, context);

    expect(verdict).toEqual({ allowFinish: true, feedback: undefined });
    expect(passes(events)).toEqual([
      "assumptions_list.md",
      "assumptions_record.md",
      "assumptions_classify.md",
      "assumptions_decide.md",
    ]);
    expect(texts(firstInputFor(model.inputs, "RECORD"))).toEqual([
      `RECORD\n- itnt_a: Summarize PR comments\n${LIST.text}`,
    ]);
    const classifyInput = texts(firstInputFor(model.inputs, "CLASSIFY"));
    expect(classifyInput.slice(0, 3)).toEqual(texts(conversation));
    expect(classifyInput[3]).toContain("## Open Assumptions");
    expect(governor.state.assumptions.map((a) => a.text)).toEqual(["the PR is #4"]);
  });

  it("resolved assumptions skip classify and depends_on links by parent text", async () => {
    const { context, events } = recordingContext();
    const { governor } = scriptedGovernor(
      runtime,
      [
        LIST,
        record({ evidence: "user said PR #4" }),
        record({ text: "PR #4 is open", evidence: "state: open", depends_on: "the PR is #4" }),
        RECORDED,
        APPROVE,
      ],
      { initialState: { intent_stack: [intentA] } }
    );

    await governor.onAgentFinish(conversation, context);

    expect(passes(events)).toEqual([
      "assumptions_list.md",
      "assumptions_record.md",
      "assumptions_decide.md",
    ]);
    const [parent, child] = governor.state.assumptions;
    expect(parent.status).toBe("resolved");
    expect(child.depends_on).toBe(parent.id);
  });

  it("finish_record is refused after a refused record", async () => {
    const { context } = recordingContext();
    const { governor } = scriptedGovernor(
      runtime,
      [
        LIST,
        record({ depends_on: "missing parent", evidence: "x" }),
        RECORDED,
        record({ evidence: "x" }),
        RECORDED,
        APPROVE,
      ],
      { initialState: { intent_stack: [intentA] } }
    );

    await governor.onAgentFinish(conversation, context);

    expect(governor.state.assumptions.map((a) => a.depends_on)).toEqual([null]);
  });

  it("asks flagged assumptions and approves when every answer is confirm", async () => {
    const asked: string[] = [];
    const askUser: AskUser = async (prompt) => {
      if (prompt.kind !== "assumptions") throw new Error(`Unexpected prompt: ${prompt.kind}`);
      asked.push(...prompt.questions.map((q) => q.label));
      return Object.fromEntries(prompt.questions.map((q) => [q.id, true]));
    };
    const { context, events } = recordingContext("t1", 1, askUser);
    const { governor } = scriptedGovernor(
      runtime,
      [
        LIST,
        record(),
        RECORDED,
        classify(() => governor, { candidates: "countable", user_would_care: true }),
        askFirst(() => governor),
        APPROVE,
      ],
      { initialState: { intent_stack: [intentA] } }
    );

    const verdict = await governor.onAgentFinish(conversation, context);

    expect(verdict.allowFinish).toBe(true);
    expect(asked).toEqual(["We assumed: the PR is #4"]);
    expect(passes(events)).toEqual([
      "assumptions_list.md",
      "assumptions_record.md",
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
        record(),
        RECORDED,
        classify(() => governor, { candidates: "countable", user_would_care: true }),
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
        record({ text: "inline threads were not needed" }),
        RECORDED,
        classify(() => governor, { resolver: "tool" }),
        classify(() => governor, {
          resolver: "tool",
          request: "Fetch the line-by-line review comments on PR #4.",
        }),
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
