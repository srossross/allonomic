import { describe, it, expect } from "bun:test";
import { createGovernorExitTools } from "../src/core/governor/tools";
import { GovernorInterceptor } from "../src/core/governor/interceptor";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { localGovernor, recordingContext } from "./helpers/turnContext";

describe("Governor Exit & Resolution Flow", () => {
  const runtime = createMemoryRuntime();
  const { context: dummyContext } = recordingContext();

  it("resolves active intent and archives it to completed history", async () => {
    const governor = localGovernor({
      intent_stack: [
        { id: "itnt_task_1", kind: "request", description: "Build component", constraints: [] },
        { id: "itnt_task_2", kind: "request", description: "Write tests", constraints: [] },
      ],
      completed_intents: [],
      global_constraints: [],
    });

    let exitVerdict: { approved: boolean; feedback?: string; nextStep?: string } | null = null;
    const tools = createGovernorExitTools(governor.dispatch, (v) => {
      exitVerdict = v;
    });

    const resolveIntent = tools.find((t) => t.name === "resolve_intent")!;
    const finish = tools.find((t) => t.name === "finish")!;

    // Resolve task 1
    const res1 = await resolveIntent.invoke({ id: "itnt_task_1" });
    const parsed1 = typeof res1 === "string" ? JSON.parse(res1) : res1;
    expect(parsed1.status).toBe("resolved");
    expect(governor.state().intent_stack.map((i) => i.id)).toEqual(["itnt_task_2"]);
    expect(governor.state().completed_intents.map((i) => i.id)).toEqual(["itnt_task_1"]);

    // Signal finish with verdict
    await finish.invoke({
      approved: true,
      nextStep: "Proceed to task 2 in next turn",
    });

    expect(exitVerdict).not.toBeNull();
    expect(exitVerdict?.approved).toBe(true);
    expect(exitVerdict?.nextStep).toBe("Proceed to task 2 in next turn");
  });

  it("onAgentFinish automatically permits finish if intent stack is empty and no constraints exist", async () => {
    const governor = new GovernorInterceptor({
      runtime,
      initialState: {
        intent_stack: [],
        completed_intents: [],
        global_constraints: [],
      },
    });

    // Provide non-existent constraints file to ensure empty constraints
    governor.constraintsContent = "";

    const verdict = await governor.onAgentFinish([], dummyContext);
    expect(verdict.allowFinish).toBe(true);
  });
});
