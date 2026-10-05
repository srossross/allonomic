import { assumption } from "./helpers/governorFixtures";
import { describe, it, expect } from "bun:test";
import { createTurnEventLog } from "../src/core/turn/eventLog";
import { foldTurnEvents } from "../src/core/turn/transcript";
import type { GovernorAction } from "../src/core/governor/types";
import { createRejectedResult } from "../src/core/userPrompt";

const prompt = { kind: "confirm" as const, label: "rm x" };

function toolTurn(toolContent: string | null) {
  const { sink, events } = createTurnEventLog(1, []);
  sink.emit({ type: "turn_started", threadId: "t", prompt: "delete" });
  sink.emit({
    type: "governor_action",
    phase: "entry",
    interceptor: "Governor",
    action: {
      type: "push_intent",
      intent: { id: "i1", kind: "request", description: "delete x" },
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
  sink.emit(
    toolContent === null
      ? { type: "prompt_requested", promptId: "p1", toolCallId: "c1", prompt }
      : {
          type: "tool_result",
          toolCallId: "c1",
          name: "run_mutating_command",
          content: toolContent,
        }
  );
  return events;
}

describe("transcript reducer", () => {
  it("builds user and assistant messages with tool status from events", () => {
    const t = foldTurnEvents(toolTurn(null));
    expect(t.messages.map((m) => [m.id, m.role])).toEqual([
      ["user-1", "user"],
      ["s1", "assistant"],
    ]);
    const step = t.messages[1];
    expect(step.thinking).toBe("should delete");
    expect(step.thinkingDurationSeconds).toBe(2);
    expect(step.toolCalls?.[0]).toMatchObject({
      id: "c1",
      status: "pending",
      prompt,
      promptId: "p1",
    });
    expect(t.governorState.intent_stack.map((i) => i.id)).toEqual(["i1"]);
    expect(t.contextMessages.map((m) => m.role)).toEqual(["human", "ai"]);
    expect(t.consoleEvents.map((e) => e.type)).toEqual([
      "user_prompt",
      "governor_entry",
      "worker_thought",
      "worker_tool_call",
      "governor_pre_tool",
      "action",
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

  it("an answered prompt clears the prompt and the result updates the same tool card", () => {
    const first = foldTurnEvents(toolTurn(null));
    const { sink, events } = createTurnEventLog(1, []);
    sink.emit({ type: "prompt_answered", promptId: "p1", value: true });
    const answered = foldTurnEvents(events, first);
    expect(answered.messages[1].toolCalls?.[0]).toMatchObject({
      status: "running",
      prompt: undefined,
      promptId: undefined,
    });
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

  it("replays assumption actions into governorState.assumptions", () => {
    const { sink, events } = createTurnEventLog(1, []);
    sink.emit({ type: "turn_started", threadId: "t", prompt: "add a box" });
    const emit = (action: GovernorAction) =>
      sink.emit({ type: "governor_action", phase: "exit", interceptor: "Governor", action });
    emit({
      type: "push_intent",
      intent: { id: "i1", kind: "request", description: "add a box" },
    });
    emit({ type: "record_assumption", assumption: assumption("r1", "i1") });
    emit({ type: "resolve_assumption", id: "r1", evidence: "user confirmed" });

    const t = foldTurnEvents(events);
    expect(t.governorState.assumptions).toHaveLength(1);
    expect(t.governorState.assumptions[0]).toMatchObject({
      id: "r1",
      status: "resolved",
      evidence: "user confirmed",
    });
    expect(t.consoleEvents.map((e) => e.summary)).toContain(
      "resolve_assumption: 'r1' — user confirmed"
    );
  });

  it("tracks a pending prompt that has no tool call until it is answered", () => {
    const { sink, events } = createTurnEventLog(1, []);
    const assumptionPrompt = {
      kind: "assumptions" as const,
      label: "Confirm 1 assumption",
      questions: [{ id: "a1", topic: "X", label: "We assumed: x", options: [] }],
    };
    sink.emit({ type: "prompt_requested", promptId: "p9", prompt: assumptionPrompt });
    expect(foldTurnEvents(events).pendingPrompt).toEqual({
      promptId: "p9",
      prompt: assumptionPrompt,
    });
    sink.emit({ type: "prompt_answered", promptId: "p9", value: true });
    expect(foldTurnEvents(events).pendingPrompt).toBeUndefined();
  });

  it("adds one governor marker per exit and one per popped intent", () => {
    const { sink, events } = createTurnEventLog(1, []);
    const emit = (action: GovernorAction) =>
      sink.emit({ type: "governor_action", phase: "exit", interceptor: "Governor", action });
    const verdict = (isApproved: boolean, intentId?: string) =>
      sink.emit({
        type: "governor_verdict",
        phase: "exit",
        interceptor: "Governor",
        approved: isApproved,
        intentId,
      });
    emit({
      type: "push_intent",
      intent: { id: "i1", kind: "request", description: "add a box", completed_when: "box added" },
    });
    emit({ type: "push_intent", intent: { id: "i2", kind: "request", description: "paint it" } });
    emit({ type: "record_assumption", assumption: assumption("r1", "i1") });
    verdict(false, "i1");
    emit({ type: "pop_intent" });
    emit({ type: "resolve_intent", id: "i1" });
    verdict(true);
    verdict(true);

    const markers = foldTurnEvents(events).messages.map((m) => m.governor);
    const exit = { kind: "exit", interceptor: "Governor", assumptions: [assumption("r1", "i1")] };
    expect(markers).toEqual([
      { ...exit, approved: false, resolved: [], unmetIntent: "add a box" },
      { kind: "popped", interceptor: "Governor", intent: "paint it" },
      { ...exit, approved: true, resolved: [{ id: "i1", text: "box added" }] },
      { ...exit, approved: true, resolved: [] },
    ]);
  });
});

function preamble(loadedAt: string, isMissing = false) {
  return { path: "/r/preamble.md", size: isMissing ? 0 : 10, missing: isMissing, loadedAt };
}

describe("agent files projection", () => {
  it("merges hooks per agent+path and keeps the latest load", () => {
    const { sink, events } = createTurnEventLog(1, []);
    sink.emit({
      type: "context_files_loaded",
      agent: "governor",
      hook: "userPrompt",
      files: [preamble("2026-01-01T00:00:01Z")],
    });
    sink.emit({
      type: "context_files_loaded",
      agent: "governor",
      hook: "preTool",
      files: [preamble("2026-01-01T00:00:02Z", true)],
    });
    sink.emit({
      type: "context_files_loaded",
      agent: "governor",
      hook: "userPrompt",
      files: [preamble("2026-01-01T00:00:00Z")],
    });
    sink.emit({
      type: "context_files_loaded",
      agent: "teacher",
      hook: "preTool",
      files: [preamble("2026-01-01T00:00:03Z")],
    });

    expect(foldTurnEvents(events).agentFiles).toEqual([
      {
        agent: "governor",
        path: "/r/preamble.md",
        size: 0,
        missing: true,
        lastLoadedAt: "2026-01-01T00:00:02Z",
        hooks: ["userPrompt", "preTool"],
      },
      {
        agent: "teacher",
        path: "/r/preamble.md",
        size: 10,
        missing: false,
        lastLoadedAt: "2026-01-01T00:00:03Z",
        hooks: ["preTool"],
      },
    ]);
  });
});
