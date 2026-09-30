import { describe, it, expect } from "bun:test";
import { createGovernorPromptTools } from "../src/core/governor/tools";
import { createGovernorFalseCompletionTools } from "../src/core/governor/falseCompletionTools";
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
        changelog: ["User wants blue instead of red"],
      },
    ]);
  });

  it("falseCompletion tools add, resolve and finish", async () => {
    const governor = localGovernor();
    await createGovernorPromptTools(governor.dispatch, () => {})
      .find((t) => t.name === "push_intent")!
      .invoke({
        id: "itnt_a",
        kind: "request",
        description: "Add an image box",
        completed_when: "An image box is on the page",
      });

    let reasoning: string | undefined;
    const tools = createGovernorFalseCompletionTools(
      governor.dispatch,
      governor.state,
      (r) => {
        reasoning = r;
      },
      () => {}
    );
    const addFalseCompletion = tools.find((t) => t.name === "add_false_completion")!;
    const resolveFalseCompletion = tools.find((t) => t.name === "resolve_false_completion")!;
    const noFalseCompletions = tools.find((t) => t.name === "no_false_completions")!;
    const finish = tools.find((t) => t.name === "finish")!;

    const added = parse(
      await addFalseCompletion.invoke({
        intent_id: "itnt_a",
        summary: "Image styled with ad hoc CSS",
        completes_as: "The image added with inline styles",
        false_because: "The project has a reusable box style the agent did not use",
        check: "Search the stylesheets for an existing box class",
        evidence: { source: "styles.css", quote: ".box { width: 100% }" },
      })
    );
    expect(added.status).toBe("created");
    const [created] = governor.state().false_completions;
    expect(created).toMatchObject({
      id: added.id,
      intent_id: "itnt_a",
      evidence: { source: "styles.css", quote: ".box { width: 100% }" },
      resolution: null,
      resolution_reason: null,
    });
    expect(created.id).toStartWith("fcomp_");

    const resolved = parse(
      await resolveFalseCompletion.invoke({
        id: added.id,
        resolution: "invalid",
        reason: "Raised in error",
      })
    );
    expect(resolved.status).toBe("resolved");
    expect(governor.state().false_completions[0].resolution).toBe("invalid");

    const second = parse(
      await addFalseCompletion.invoke({
        intent_id: "itnt_a",
        summary: "Box size guessed",
        completes_as: "The image added at its default size",
        false_because: "The image does not match the grid",
        check: "Compare the image width with the grid column width",
      })
    );
    const evidence = { source: "styles.css", quote: ".box { width: 100% }" };
    const missingAssumed = parse(
      await resolveFalseCompletion.invoke({
        id: second.id,
        reason: "styles checked",
        resolution: "ruled_out",
        evidence,
      })
    );
    expect(missingAssumed.status).toBe("error");
    expect(governor.state().false_completions[1].resolution).toBeNull();

    const ruledOut = parse(
      await resolveFalseCompletion.invoke({
        id: second.id,
        reason: "styles checked",
        resolution: "ruled_out",
        evidence,
        still_assumed: "the grid uses .box",
      })
    );
    expect(ruledOut.status).toBe("resolved");
    expect(governor.state().false_completions[1].still_assumed).toBe("the grid uses .box");

    expect(
      parse(await noFalseCompletions.invoke({ intent_id: "itnt_a", reason: "settled" })).status
    ).toBe("acknowledged");
    await finish.invoke({ reasoning: "False completions recorded." });
    expect(reasoning).toBe("False completions recorded.");
  });

  it("finish fails until every active intent has an open false completion or no_false_completions", async () => {
    const governor = localGovernor();
    const pushIntent = createGovernorPromptTools(governor.dispatch, () => {}).find(
      (t) => t.name === "push_intent"
    )!;
    await pushIntent.invoke({
      id: "itnt_a",
      kind: "request",
      description: "Verify comments",
      completed_when: "Each comment has a verdict",
    });
    await pushIntent.invoke({
      id: "itnt_b",
      kind: "question",
      description: "Ask about CI",
      completed_when: "User knows about CI",
    });

    let isFinished = false;
    const rejections: string[] = [];
    const tools = createGovernorFalseCompletionTools(
      governor.dispatch,
      governor.state,
      () => {
        isFinished = true;
      },
      (message) => {
        rejections.push(message);
      }
    );
    const addFalseCompletion = tools.find((t) => t.name === "add_false_completion")!;
    const noFalseCompletions = tools.find((t) => t.name === "no_false_completions")!;
    const finish = tools.find((t) => t.name === "finish")!;

    const first = parse(await finish.invoke({}));
    expect(first.status).toBe("error");
    expect(first.message).toContain("itnt_a");
    expect(first.message).toContain("itnt_b");
    expect(isFinished).toBe(false);
    expect(rejections).toEqual([first.message]);

    await addFalseCompletion.invoke({
      intent_id: "itnt_a",
      summary: "Verified against the wrong code",
      completes_as: "Verdicts for each comment against the local checkout",
      false_because: "The local checkout may not be the PR head commit Copilot reviewed",
      check: "Compare git rev-parse HEAD with gh pr view --json headRefOid",
    });
    const second = parse(await finish.invoke({}));
    expect(second.status).toBe("error");
    expect(second.message).not.toContain("itnt_a");
    expect(second.message).toContain("itnt_b");

    expect(
      parse(await noFalseCompletions.invoke({ intent_id: "missing", reason: "settled" })).status
    ).toBe("not_found");
    await noFalseCompletions.invoke({ intent_id: "itnt_b", reason: "settled" });
    expect(parse(await finish.invoke({})).status).toBe("finished");
    expect(isFinished).toBe(true);
  });
});
