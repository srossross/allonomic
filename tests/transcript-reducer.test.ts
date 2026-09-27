import { describe, it, expect } from "bun:test";
import { createTurnEventLog } from "../src/core/turn/eventLog";
import { foldTurnEvents } from "../src/core/turn/transcript";
import { createPendingResult, createRejectedResult } from "../src/core/userPrompt";

const prompt = { kind: "confirm" as const, label: "rm x" };

function toolTurn(toolContent: string) {
  const { sink, events } = createTurnEventLog(1, []);
  sink.emit({ type: "turn_started", threadId: "t", prompt: "delete" });
  sink.emit({
    type: "governor_action",
    phase: "entry",
    interceptor: "Governor",
    action: {
      type: "push_intent",
      intent: { id: "i1", kind: "request", description: "delete x", constraints: [] },
    },
  });
  sink.emit({
    type: "model_step",
    stepId: "s1",
    content: "",
    thinking: "should delete",
    toolCalls: [{ id: "c1", name: "run_mutating_command", args: { command: "rm x" } }],
    durationMs: 1500,
  });
  sink.emit({
    type: "governor_tool_decision",
    interceptor: "Governor",
    tool: "run_mutating_command",
    args: {},
    approved: true,
  });
  sink.emit({
    type: "tool_result",
    toolCallId: "c1",
    name: "run_mutating_command",
    content: toolContent,
  });
  return events;
}

describe("transcript reducer", () => {
  it("builds user and assistant messages with tool status from events", () => {
    const t = foldTurnEvents(toolTurn(createPendingResult(prompt)));
    expect(t.messages.map((m) => [m.id, m.role])).toEqual([
      ["user-1", "user"],
      ["s1", "assistant"],
    ]);
    const step = t.messages[1];
    expect(step.thinking).toBe("should delete");
    expect(step.thinkingDurationSeconds).toBe(2);
    expect(step.toolCalls?.[0]).toMatchObject({ id: "c1", status: "pending", prompt });
    expect(t.governorState.intent_stack.map((i) => i.id)).toEqual(["i1"]);
    expect(t.contextMessages.map((m) => m.role)).toEqual(["human", "ai", "tool"]);
    expect(t.consoleEvents.map((e) => e.type)).toEqual([
      "user_prompt",
      "governor_entry",
      "worker_thought",
      "worker_tool_call",
      "governor_pre_tool",
      "tool_result",
    ]);
  });

  it("marks rejected and executed results", () => {
    const rejected = foldTurnEvents(toolTurn(createRejectedResult("run_mutating_command", prompt)));
    expect(rejected.messages[1].toolCalls?.[0]).toMatchObject({
      status: "rejected",
      prompt: undefined,
    });
    const executed = foldTurnEvents(toolTurn("removed x"));
    expect(executed.messages[1].toolCalls?.[0]).toMatchObject({
      status: "executed",
      result: "removed x",
    });
  });

  it("marks tool calls running until a result arrives", () => {
    const events = toolTurn("done").filter((e) => e.type !== "tool_result");
    expect(foldTurnEvents(events).messages[1].toolCalls?.[0].status).toBe("running");
  });

  it("keeps a governor-blocked call blocked after its result", () => {
    const events = toolTurn("[INTERCEPTED by Governor]: no").map((e) =>
      e.type === "governor_tool_decision"
        ? { ...e, toolCallId: "c1", approved: false, reason: "off intent" }
        : e
    );
    expect(foldTurnEvents(events).messages[1].toolCalls?.[0]).toMatchObject({
      status: "blocked",
      reason: "off intent",
      result: "[INTERCEPTED by Governor]: no",
    });
  });

  it("a resumed turn updates the earlier tool card without adding a user message", () => {
    const first = foldTurnEvents(toolTurn(createPendingResult(prompt)));
    const { sink, events } = createTurnEventLog(2, []);
    sink.emit({ type: "turn_started", threadId: "t", prompt: null });
    sink.emit({
      type: "tool_result",
      toolCallId: "c1",
      name: "run_mutating_command",
      content: "approved",
    });
    sink.emit({ type: "model_step", stepId: "s2", content: "done", toolCalls: [], durationMs: 10 });
    sink.emit({
      type: "governor_action",
      phase: "exit",
      interceptor: "Governor",
      action: { type: "resolve_intent", id: "i1" },
    });
    sink.emit({ type: "turn_completed", retries: 0, finalResponse: "done" });
    const t = foldTurnEvents(events, first);

    expect(t.messages.map((m) => m.id)).toEqual(["user-1", "s1", "s2"]);
    expect(t.messages[1].toolCalls?.[0]).toMatchObject({ status: "executed", result: "approved" });
    expect(t.governorState.completed_intents.map((i) => i.id)).toEqual(["i1"]);
    expect(t.consoleEvents.at(-1)?.badge).toBe("DONE");
  });

  it("shows an error message for failures but not for user stops", () => {
    const { sink, events } = createTurnEventLog(1, []);
    sink.emit({ type: "turn_failed", error: "boom", aborted: false });
    sink.emit({ type: "turn_failed", error: "Generation stopped by user", aborted: true });
    const t = foldTurnEvents(events);
    expect(t.messages.map((m) => m.content)).toEqual(["Error: boom"]);
    expect(t.consoleEvents.map((e) => e.badge)).toEqual(["ERROR", "STOP"]);
  });
});
