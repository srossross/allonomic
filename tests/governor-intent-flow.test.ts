import { describe, it, expect } from "bun:test";
import { createGovernorPromptTools } from "../src/core/governor/tools";
import { localGovernor } from "./helpers/turnContext";

function parse(result: unknown) {
  return typeof result === "string" ? JSON.parse(result) : result;
}

describe("Governor Intent & State Flow", () => {
  it("initializes empty and accepts pushed intents", async () => {
    const governor = localGovernor();
    const pushIntent = createGovernorPromptTools(governor.dispatch, () => {}).find(
      (t) => t.name === "push_intent"
    )!;

    const parsed1 = parse(
      await pushIntent.invoke({
        kind: "question",
        description: "User is asking if we can build a rust CLI",
        constraints: ["do not edit cargo yet"],
      })
    );
    expect(parsed1.status).toBe("created");
    expect(governor.state().intent_stack.length).toBe(1);
    expect(governor.state().intent_stack[0].kind).toBe("question");
    expect(governor.state().intent_stack[0].constraints).toContain("do not edit cargo yet");

    const parsed2 = parse(
      await pushIntent.invoke({
        id: "itnt_custom_123",
        kind: "request",
        description: "Inspect src/main.rs",
      })
    );
    expect(parsed2.intent.id).toBe("itnt_custom_123");
    expect(governor.state().intent_stack.length).toBe(2);
    expect(governor.state().intent_stack.at(-1)?.id).toBe("itnt_custom_123");
  });

  it("handles pop_intent by ID and by LIFO stack top", async () => {
    const governor = localGovernor({
      intent_stack: [
        { id: "itnt_1", kind: "request", description: "First task", constraints: [] },
        { id: "itnt_2", kind: "request", description: "Second task", constraints: [] },
      ],
      completed_intents: [],
      global_constraints: [],
    });
    const popIntent = createGovernorPromptTools(governor.dispatch, () => {}).find(
      (t) => t.name === "pop_intent"
    )!;

    expect(parse(await popIntent.invoke({ id: "itnt_1" })).status).toBe("popped");
    expect(governor.state().intent_stack.map((i) => i.id)).toEqual(["itnt_2"]);

    const parsed2 = parse(await popIntent.invoke({}));
    expect(parsed2.status).toBe("popped");
    expect(parsed2.id).toBe("itnt_2");
    expect(governor.state().intent_stack.length).toBe(0);

    expect(parse(await popIntent.invoke({})).status).toBe("empty");
  });

  it("adds and removes global and targeted constraints", async () => {
    const governor = localGovernor({
      intent_stack: [
        { id: "itnt_alpha", kind: "request", description: "Compile", constraints: [] },
      ],
      completed_intents: [],
      global_constraints: [],
    });
    const tools = createGovernorPromptTools(governor.dispatch, () => {});
    const addConstraint = tools.find((t) => t.name === "add_constraint")!;
    const removeConstraint = tools.find((t) => t.name === "remove_constraint")!;

    await addConstraint.invoke({ constraint: "Never delete .git", target: "global" });
    expect(governor.state().global_constraints).toContain("Never delete .git");

    await addConstraint.invoke({ constraint: "Use --release flag", target: "itnt_alpha" });
    expect(governor.state().intent_stack[0].constraints).toContain("Use --release flag");

    await removeConstraint.invoke({ constraint: "Never delete .git", target: "global" });
    expect(governor.state().global_constraints).not.toContain("Never delete .git");

    await removeConstraint.invoke({ constraint: "Use --release flag", target: "itnt_alpha" });
    expect(governor.state().intent_stack[0].constraints).not.toContain("Use --release flag");
  });

  it("signals finish with reasoning to transition out of entry interceptor", async () => {
    let reasoning: string | undefined;
    let isFinished = false;
    const finish = createGovernorPromptTools(localGovernor().dispatch, (r) => {
      isFinished = true;
      reasoning = r;
    }).find((t) => t.name === "finish")!;

    await finish.invoke({ reasoning: "User intent captured and aligned." });
    expect(isFinished).toBe(true);
    expect(reasoning).toBe("User intent captured and aligned.");
  });
});
