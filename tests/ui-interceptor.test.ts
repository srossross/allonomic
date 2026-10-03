import { describe, it, expect } from "bun:test";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { UiInterceptor, type ResolvedIntentSource } from "../src/core/ui/interceptor";
import { userPromptMessage } from "../src/core/graph/userPrompt";
import { messageText } from "../src/core/graph/thinking";
import { foldTurnEvents } from "../src/core/turn/transcript";
import { replayWorkerMessages } from "../src/core/turn/ops";
import { turnEventSchema, type TurnEvent } from "../src/core/turn/events";
import { scriptedGovernorModel } from "./helpers/governorModel";
import { recordingContext } from "./helpers/turnContext";

const conversation = [
  new SystemMessage("worker system prompt"),
  userPromptMessage("add retry, max 3"),
  new AIMessage({ content: "", tool_calls: [{ id: "c1", name: "shell", args: {} }] }),
  new ToolMessage({ content: "retry.test.ts:\n  ✓ retries   on 5xx\n1 pass", tool_call_id: "c1" }),
  new AIMessage("done: retry x3"),
];

const support = (source: string, quote: string, method = "ran") => ({
  name: "evidence",
  args: { claim: "c", support: [{ source, quote, method }] },
});

async function scriptedUi(
  script: Parameters<typeof scriptedGovernorModel>[0],
  intents?: ResolvedIntentSource
) {
  const runtime = createMemoryRuntime();
  await runtime.fs.writeText("/resources/app-data/prompts/ui/ui.md", "PRESENT");
  const model = scriptedGovernorModel(script);
  const ui = new UiInterceptor({
    runtime,
    intents,
    apiKey: "test",
    createModel: model.createModel,
  });
  return { ui, model };
}

const presenterInstruction = (model: ReturnType<typeof scriptedGovernorModel>) =>
  messageText(model.inputs[0].at(-1)!.content);

const presentationOf = (events: TurnEvent[]) =>
  events.find((e) => e.type === "presentation")?.presentation;

describe("UiInterceptor", () => {
  it("emits one presentation built from the tool calls", async () => {
    const { ui } = await scriptedUi([
      { name: "response", args: { body: "Added 3 retries." } },
      {
        name: "response_detail",
        args: { question: "What backoff?", answer: "Exponential", body: "200ms base, 5s max." },
      },
      { name: "callout", args: { title: "Backoff max hardcoded.", details: "5s, no setting." } },
      {
        name: "evidence",
        args: {
          claim: "retries on 5xx",
          support: [{ source: "c1", quote: "✓ retries on 5xx", method: "tested" }],
          gap: "429 not tested",
        },
      },
      { name: "question", args: { prompt: "Retry on 429?" } },
      { name: "finish" },
    ]);
    const { context, events } = recordingContext("t", 1);
    await ui.onPresent(conversation, context);
    expect(presentationOf(events)).toEqual({
      response: "Added 3 retries.",
      responseDetails: [
        { question: "What backoff?", answer: "Exponential", body: "200ms base, 5s max." },
      ],
      callouts: [{ title: "Backoff max hardcoded.", details: "5s, no setting." }],
      questions: [{ prompt: "Retry on 429?" }],
      evidence: [
        {
          claim: "retries on 5xx",
          support: [{ source: "c1", quote: "✓ retries on 5xx", method: "tested" }],
          gap: "429 not tested",
        },
      ],
    });
    for (const event of events) expect(turnEventSchema.safeParse(event).success).toBe(true);
  });

  it("rejects evidence whose quote is not in its source", async () => {
    const { ui, model } = await scriptedUi([
      { name: "response", args: { body: "answer" } },
      support("c1", "2 pass"),
      support("c9", "1 pass"),
      support("user", "max 3"),
      support("c1", "1 pass", "stated"),
      support("user", "max 3", "stated"),
      { name: "evidence", args: { claim: "unchecked", support: [] } },
      { name: "finish" },
    ]);
    const { context, events } = recordingContext("t", 1);
    await ui.onPresent(conversation, context);
    const results = model.inputs
      .at(-1)!
      .slice(conversation.length + 1)
      .filter((m) => m instanceof ToolMessage)
      .map((m) => messageText(m.content));
    expect(results.slice(1, 5).every((r) => r.startsWith("Error: nothing added."))).toBe(true);
    expect(presentationOf(events)?.evidence).toEqual([
      { claim: "c", support: [{ source: "user", quote: "max 3", method: "stated" }] },
      { claim: "unchecked", support: [] },
    ]);
  });

  it("finish is refused until the response is given", async () => {
    const { ui, model } = await scriptedUi([
      { name: "finish" },
      { name: "response", args: { body: "answer" } },
      { name: "finish" },
    ]);
    const { context, events } = recordingContext("t", 1);
    await ui.onPresent(conversation, context);
    expect(model.calls()).toBe(3);
    expect(presentationOf(events)?.response).toBe("answer");
  });

  it("presents against the last user prompt, not later injected messages", async () => {
    const { ui, model } = await scriptedUi(
      [{ name: "response", args: { body: "answer" } }, { name: "finish" }],
      {
        resolvedSincePrompt: () => [
          {
            id: "i1",
            kind: "request",
            description: "Apply all fixes",
            completed_when: "fixes applied",
            overstep: null,
            specificity: null,
            changelog: [],
          },
        ],
      }
    );
    const { context } = recordingContext("t", 1);
    await ui.onPresent(
      [
        new SystemMessage("worker system prompt"),
        userPromptMessage("ok, please apply all fixes"),
        new HumanMessage("[Governor]: Goal: apply fixes"),
        new AIMessage("applied"),
        new HumanMessage("Your output did not satisfy the exit criteria: fix the unit test"),
        new AIMessage("fixed the unit test"),
      ],
      context
    );
    expect(presenterInstruction(model)).toBe(
      [
        "PRESENT",
        "## User message\n\nok, please apply all fixes",
        "## Intents resolved\n\n- Apply all fixes (done when: fixes applied)",
      ].join("\n\n")
    );
  });

  it("omits resolved intents when there are none", async () => {
    const { ui, model } = await scriptedUi([
      { name: "response", args: { body: "answer" } },
      { name: "finish" },
    ]);
    const { context } = recordingContext("t", 1);
    await ui.onPresent([userPromptMessage("add retry"), new AIMessage("done")], context);
    expect(presenterInstruction(model)).toBe("PRESENT\n\n## User message\n\nadd retry");
  });

  it("does nothing when disabled", async () => {
    const { ui, model } = await scriptedUi([{ name: "finish" }]);
    ui.setIsEnabled(false);
    const { context, events } = recordingContext("t", 1);
    await ui.onPresent(conversation, context);
    expect(events).toEqual([]);
    expect(model.calls()).toBe(0);
  });

  it("presentation folds into a message that is excluded from worker history", async () => {
    const { ui } = await scriptedUi([
      { name: "response", args: { body: "answer" } },
      { name: "finish" },
    ]);
    const { context, events } = recordingContext("t", 1);
    await ui.onPresent(conversation, context);
    const { messages } = foldTurnEvents(events);
    expect(messages.at(-1)?.presentation?.response).toBe("answer");
    expect(replayWorkerMessages(events)).toEqual([]);
  });
});
