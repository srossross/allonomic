import { describe, it, expect } from "bun:test";
import { createGovernorPromptTools } from "../src/interceptor-agents/governor/tools";
import type { GovernorState } from "../src/interceptor-agents/governor/types";

describe("Governor Intent & State Flow", () => {
  it("initializes empty and accepts pushed intents", async () => {
    const state: GovernorState = {
      intent_stack: [],
      completed_intents: [],
      global_constraints: [],
    };
    const tools = createGovernorPromptTools(state, () => {});

    const pushIntent = tools.find((t) => t.name === "push_intent")!;
    expect(pushIntent).toBeDefined();

    // 1. Push a question intent
    const result1 = await pushIntent.invoke({
      kind: "question",
      description: "User is asking if we can build a rust CLI",
      constraints: ["do not edit cargo yet"],
    });

    const parsed1 = typeof result1 === "string" ? JSON.parse(result1) : result1;
    expect(parsed1.status).toBe("created");
    expect(state.intent_stack.length).toBe(1);
    expect(state.intent_stack[0].kind).toBe("question");
    expect(state.intent_stack[0].constraints).toContain("do not edit cargo yet");

    // 2. Push a sub-request intent with explicit ID
    const result2 = await pushIntent.invoke({
      id: "itnt_custom_123",
      kind: "request",
      description: "Inspect src/main.rs",
    });
    const parsed2 = typeof result2 === "string" ? JSON.parse(result2) : result2;
    expect(parsed2.intent.id).toBe("itnt_custom_123");
    expect(state.intent_stack.length).toBe(2);
    expect(state.intent_stack.at(-1)?.id).toBe("itnt_custom_123");
  });

  it("handles pop_intent by ID and by LIFO stack top", async () => {
    const state: GovernorState = {
      intent_stack: [
        { id: "itnt_1", kind: "request", description: "First task", constraints: [] },
        { id: "itnt_2", kind: "request", description: "Second task", constraints: [] },
      ],
      completed_intents: [],
      global_constraints: [],
    };
    const tools = createGovernorPromptTools(state, () => {});
    const popIntent = tools.find((t) => t.name === "pop_intent")!;

    // Pop specific intent by id
    const res1 = await popIntent.invoke({ id: "itnt_1" });
    const parsed1 = typeof res1 === "string" ? JSON.parse(res1) : res1;
    expect(parsed1.status).toBe("popped");
    expect(state.intent_stack.length).toBe(1);
    expect(state.intent_stack[0].id).toBe("itnt_2");

    // Pop top intent (omitting id)
    const res2 = await popIntent.invoke({});
    const parsed2 = typeof res2 === "string" ? JSON.parse(res2) : res2;
    expect(parsed2.status).toBe("popped");
    expect(parsed2.id).toBe("itnt_2");
    expect(state.intent_stack.length).toBe(0);

    // Pop on empty stack returns status empty
    const res3 = await popIntent.invoke({});
    const parsed3 = typeof res3 === "string" ? JSON.parse(res3) : res3;
    expect(parsed3.status).toBe("empty");
  });

  it("adds and removes global and targeted constraints", async () => {
    const state: GovernorState = {
      intent_stack: [
        { id: "itnt_alpha", kind: "request", description: "Compile", constraints: [] },
      ],
      completed_intents: [],
      global_constraints: [],
    };
    const tools = createGovernorPromptTools(state, () => {});
    const addConstraint = tools.find((t) => t.name === "add_constraint")!;
    const removeConstraint = tools.find((t) => t.name === "remove_constraint")!;

    // Add global constraint
    await addConstraint.invoke({ constraint: "Never delete .git", target: "global" });
    expect(state.global_constraints).toContain("Never delete .git");

    // Add targeted constraint to specific intent
    await addConstraint.invoke({ constraint: "Use --release flag", target: "itnt_alpha" });
    expect(state.intent_stack[0].constraints).toContain("Use --release flag");

    // Remove global constraint
    await removeConstraint.invoke({ constraint: "Never delete .git", target: "global" });
    expect(state.global_constraints).not.toContain("Never delete .git");

    // Remove targeted constraint
    await removeConstraint.invoke({ constraint: "Use --release flag", target: "itnt_alpha" });
    expect(state.intent_stack[0].constraints).not.toContain("Use --release flag");
  });

  it("signals finish to transition out of entry interceptor", async () => {
    const state: GovernorState = {
      intent_stack: [],
      completed_intents: [],
      global_constraints: [],
    };
    let isFinishedCalled = false;
    const tools = createGovernorPromptTools(state, () => {
      isFinishedCalled = true;
    });
    const finish = tools.find((t) => t.name === "finish")!;

    expect(isFinishedCalled).toBe(false);
    await finish.invoke({ reasoning: "User intent captured and aligned." });
    expect(isFinishedCalled).toBe(true);
  });
});
