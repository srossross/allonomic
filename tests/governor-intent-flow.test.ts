import { describe, it, expect } from "bun:test";
import { createGovernorPromptTools } from "../src/core/governor/tools";
import { localGovernor } from "./helpers/turnContext";
import { parse } from "./helpers/governorFixtures";

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
        completed_when: "User knows whether we can build a rust CLI",
        overstep: "Scaffolding the CLI",
        specificity: "low",
      })
    );
    expect(parsed1.status).toBe("created");
    expect(governor.state().intent_stack.length).toBe(1);
    expect(governor.state().intent_stack[0].kind).toBe("question");

    const parsed2 = parse(
      await pushIntent.invoke({
        id: "itnt_custom_123",
        kind: "request",
        description: "Inspect src/main.rs",
        completed_when: "src/main.rs has been inspected",
        overstep: "Editing src/main.rs",
        specificity: "high",
      })
    );
    expect(parsed2.intent.id).toBe("itnt_custom_123");
    expect(governor.state().intent_stack.length).toBe(2);
    expect(governor.state().intent_stack.at(-1)?.id).toBe("itnt_custom_123");
  });

  it("handles pop_intent by ID and by LIFO stack top", async () => {
    const governor = localGovernor({
      intent_stack: [
        {
          id: "itnt_1",
          kind: "request",
          description: "First task",
          completed_when: null,
          changelog: [],
        },
        {
          id: "itnt_2",
          kind: "request",
          description: "Second task",
          completed_when: null,
          changelog: [],
        },
      ],
      completed_intents: [],
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

  it("update_intent revises an intent in place", async () => {
    const governor = localGovernor();
    const tools = createGovernorPromptTools(governor.dispatch, () => {});
    await tools
      .find((t) => t.name === "push_intent")!
      .invoke({
        id: "itnt_a",
        kind: "request",
        description: "Add a red box",
        completed_when: "A red box is on the page",
        overstep: "Restyling the page",
        specificity: "high",
      });
    const parsed = parse(
      await tools
        .find((t) => t.name === "update_intent")!
        .invoke({
          id: "itnt_a",
          description: "Add a blue box",
          completed_when: "A blue box is on the page",
          what_changed: "User wants blue instead of red",
        })
    );
    expect(parsed.status).toBe("updated");
    expect(governor.state().intent_stack).toEqual([
      {
        id: "itnt_a",
        kind: "request",
        description: "Add a blue box",
        completed_when: "A blue box is on the page",
        overstep: "Restyling the page",
        specificity: "high",
        changelog: ["User wants blue instead of red"],
      },
    ]);
  });
});
