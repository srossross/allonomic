import { describe, it, expect } from "bun:test";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { GovernorInterceptor } from "../src/core/governor/interceptor";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { recordingContext } from "./helpers/turnContext";
import { scriptedGovernorModel } from "./helpers/governorModel";

const questionIntent = {
  id: "itnt_q1",
  kind: "question" as const,
  description: "User wants to know if the agent can perform a code review",
  constraints: [],
};

const conversation = [
  new SystemMessage("worker system prompt"),
  new HumanMessage("can you do a code review?"),
  new AIMessage({
    content: "",
    tool_calls: [{ id: "call_1114355", name: "list_files", args: { directory: "src" } }],
  }),
];

describe("Governor Pre-Tool Interception Flow", () => {
  const runtime = createMemoryRuntime();

  it("denies with an intent-aware message when the model calls deny", async () => {
    const { context, events } = recordingContext();
    const model = scriptedGovernorModel([
      { name: "deny", args: { reason: "question should be answered, not performed" } },
    ]);
    const governor = new GovernorInterceptor({
      runtime,
      apiKey: "test",
      createModel: model.createModel,
      initialState: { intent_stack: [questionIntent] },
    });

    const approval = await governor.onPreToolCall(
      { id: "call_1114355", name: "list_files", args: { directory: "src" } },
      conversation,
      context
    );

    expect(approval.approved).toBe(false);
    expect(approval.reason).toContain("We have interpreted the user intent as");
    expect(approval.reason).toContain(questionIntent.description);
    expect(approval.reason).toContain("call_1114355");
    expect(approval.reason).toContain("question should be answered, not performed");

    const [fork] = model.inputs;
    expect(fork.slice(0, 3)).toEqual(conversation);
    expect(fork[3]).toBeInstanceOf(ToolMessage);
    expect(fork[3]).toMatchObject({ tool_call_id: "call_1114355" });
    expect(fork[4]).toBeInstanceOf(HumanMessage);
    expect(String(fork[4].content)).toContain("You are the Governor");
    expect(conversation.length).toBe(3);

    const decision = events.find((e) => e.type === "governor_tool_decision");
    expect(decision).toMatchObject({
      tool: "list_files",
      toolCallId: "call_1114355",
      approved: false,
    });
  });

  it("approves when the model calls allow", async () => {
    const { context } = recordingContext();
    const model = scriptedGovernorModel([{ name: "allow" }]);
    const governor = new GovernorInterceptor({
      runtime,
      apiKey: "test",
      createModel: model.createModel,
      initialState: {
        intent_stack: [
          { id: "itnt_r1", kind: "request", description: "Create hello.txt file", constraints: [] },
        ],
      },
    });

    const approval = await governor.onPreToolCall(
      { id: "call_1", name: "write_file", args: { path: "hello.txt", content: "Hello world" } },
      conversation,
      context
    );
    expect(approval).toEqual({ approved: true });
  });

  it("re-prompts when the model makes no decision, then honours the decision", async () => {
    const { context } = recordingContext();
    const model = scriptedGovernorModel([null, { name: "allow" }]);
    const governor = new GovernorInterceptor({
      runtime,
      apiKey: "test",
      createModel: model.createModel,
    });

    const approval = await governor.onPreToolCall(
      { id: "call_2", name: "read_file", args: { path: "a" } },
      conversation,
      context
    );
    expect(approval.approved).toBe(true);
    expect(model.calls()).toBe(2);
  });

  it("throws when no decision is made before the step ceiling", async () => {
    const { context } = recordingContext();
    const model = scriptedGovernorModel([]);
    const governor = new GovernorInterceptor({
      runtime,
      apiKey: "test",
      createModel: model.createModel,
      initialState: { intent_stack: [questionIntent] },
    });

    await expect(
      governor.onPreToolCall(
        { id: "call_3", name: "read_file", args: { path: "a" } },
        conversation,
        context
      )
    ).rejects.toThrow(/made no decision within 50 steps/);
    expect(model.calls()).toBe(50);
  });
});
