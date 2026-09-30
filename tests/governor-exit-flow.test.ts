import { describe, it, expect } from "bun:test";
import { createGovernorExitTools } from "../src/core/governor/tools";
import { falseCompletionBlocks } from "../src/core/governor/falseCompletions";
import { GovernorInterceptor } from "../src/core/governor/interceptor";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { localGovernor, recordingContext } from "./helpers/turnContext";
import { falseCompletion, parse } from "./helpers/governorFixtures";

describe("Governor Exit & Resolution Flow", () => {
  const runtime = createMemoryRuntime();
  const { context: dummyContext } = recordingContext();

  it("resolves active intent and archives it to completed history", async () => {
    const governor = localGovernor({
      intent_stack: [
        { id: "itnt_task_1", kind: "request", description: "Build component" },
        { id: "itnt_task_2", kind: "request", description: "Write tests" },
      ],
      completed_intents: [],
      false_completions: [],
    });

    let exitVerdict: { approved: boolean } | null = null;
    const tools = createGovernorExitTools(
      governor.dispatch,
      falseCompletionBlocks(governor.state),
      (v) => {
        exitVerdict = v;
      }
    );

    const resolveIntent = tools.find((t) => t.name === "resolve_intent")!;
    const finish = tools.find((t) => t.name === "finish")!;

    const res1 = await resolveIntent.invoke({ id: "itnt_task_1" });
    expect(parse(res1).status).toBe("resolved");
    expect(governor.state().intent_stack.map((i) => i.id)).toEqual(["itnt_task_2"]);
    expect(governor.state().completed_intents.map((i) => i.id)).toEqual(["itnt_task_1"]);

    await finish.invoke({ approved: true });

    expect(exitVerdict).toEqual({ approved: true });
  });

  it("blocks resolve_intent and approval while a false completion is open", async () => {
    const governor = localGovernor({
      intent_stack: [{ id: "itnt_a", kind: "request", description: "Verify comments" }],
      completed_intents: [],
      false_completions: [
        {
          id: "fcomp_1",
          intent_id: "itnt_a",
          summary: "Verified against the wrong code",
          completes_as: "Verdicts against local code",
          false_because: "The local checkout is not the commit Copilot reviewed",
          check: "Compare git rev-parse HEAD with the PR head commit",
          evidence: null,
          resolution: null,
          resolution_reason: null,
          still_assumed: null,
        },
      ],
    });

    let exitVerdict: { approved: boolean } | null = null;
    const tools = createGovernorExitTools(
      governor.dispatch,
      falseCompletionBlocks(governor.state),
      (v) => {
        exitVerdict = v;
      }
    );
    const resolveIntent = tools.find((t) => t.name === "resolve_intent")!;
    const finish = tools.find((t) => t.name === "finish")!;

    const blockedResolve = parse(await resolveIntent.invoke({ id: "itnt_a" }));
    expect(blockedResolve.status).toBe("blocked");
    expect(blockedResolve.message).toContain("fcomp_1");
    expect(governor.state().intent_stack.map((i) => i.id)).toEqual(["itnt_a"]);

    const blockedFinish = parse(await finish.invoke({ approved: true }));
    expect(blockedFinish.status).toBe("blocked");
    expect(exitVerdict).toBeNull();

    const rejected = parse(await finish.invoke({ approved: false }));
    expect(rejected.status).toBe("finished");
    expect(exitVerdict).toEqual({ approved: false });

    governor.dispatch({
      type: "resolve_false_completion",
      id: "fcomp_1",
      resolution: "ruled_out",
      evidence: { source: "tool", quote: "HEAD matches" },
    });
    expect(parse(await resolveIntent.invoke({ id: "itnt_a" })).status).toBe("resolved");
  });

  it("blocked messages list every open false completion by id and summary", async () => {
    const governor = localGovernor({
      intent_stack: [{ id: "itnt_a", kind: "request", description: "A" }],
      completed_intents: [],
      false_completions: [
        falseCompletion("fcomp_1", "itnt_a"),
        falseCompletion("fcomp_2", "itnt_a"),
      ],
    });
    const tools = createGovernorExitTools(
      governor.dispatch,
      falseCompletionBlocks(governor.state),
      () => {}
    );
    const resolveIntent = tools.find((t) => t.name === "resolve_intent")!;
    const finish = tools.find((t) => t.name === "finish")!;

    expect(parse(await resolveIntent.invoke({ id: "itnt_a" }))).toEqual({
      status: "blocked",
      message: `Intent 'itnt_a' has open false completions: 'fcomp_1' ("summary fcomp_1"), 'fcomp_2' ("summary fcomp_2"). It cannot resolve while any remain open.`,
    });
    expect(parse(await finish.invoke({ approved: true }))).toEqual({
      status: "blocked",
      message: `Cannot approve with open false completions: 'fcomp_1' ("summary fcomp_1"), 'fcomp_2' ("summary fcomp_2"). Call finish({ approved: false }).`,
    });
  });

  it("blocks only on open false completions of intents still on the stack", async () => {
    const governor = localGovernor({
      intent_stack: [
        { id: "itnt_a", kind: "request", description: "A" },
        { id: "itnt_b", kind: "request", description: "B" },
      ],
      completed_intents: [],
      false_completions: [
        falseCompletion("fcomp_b", "itnt_b"),
        { ...falseCompletion("fcomp_a_done", "itnt_a"), resolution: "invalid" },
        falseCompletion("fcomp_gone", "itnt_gone"),
      ],
    });
    let exitVerdict: { approved: boolean } | null = null;
    const tools = createGovernorExitTools(
      governor.dispatch,
      falseCompletionBlocks(governor.state),
      (v) => {
        exitVerdict = v;
      }
    );
    const resolveIntent = tools.find((t) => t.name === "resolve_intent")!;
    const finish = tools.find((t) => t.name === "finish")!;

    expect(parse(await resolveIntent.invoke({ id: "itnt_a" })).status).toBe("resolved");
    expect(parse(await resolveIntent.invoke({ id: "itnt_b" })).status).toBe("blocked");

    governor.dispatch({ type: "pop_intent", id: "itnt_b" });
    expect(parse(await finish.invoke({ approved: true })).status).toBe("finished");
    expect(exitVerdict).toMatchObject({ approved: true });
  });

  it("onAgentFinish automatically permits finish if intent stack is empty", async () => {
    const governor = new GovernorInterceptor({
      runtime,
      initialState: {
        intent_stack: [],
        completed_intents: [],
      },
    });

    const verdict = await governor.onAgentFinish([], dummyContext);
    expect(verdict.allowFinish).toBe(true);
  });
});
