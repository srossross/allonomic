import { describe, it, expect } from "bun:test";
import { countRetries, createTurnEventLog } from "../src/core/turn/eventLog";
import { turnEventSchema, type TurnEvent, type TurnSegment } from "../src/core/turn/events";
import { formatTraceLine } from "../src/core/turn/trace";

const collect = (segments: TurnSegment[]) => (segment: TurnSegment) => {
  segments.push(segment);
};

describe("turn event log", () => {
  it("assigns seq, turnIndex and timestamp, and fans out to listeners in order", () => {
    const seen: TurnEvent[] = [];
    const { sink, events } = createTurnEventLog(7, [
      (e) => {
        seen.push(e);
      },
    ]);
    sink.emit({ type: "turn_started", threadId: "t", prompt: "hi" });
    sink.emit({ type: "exit_retry", feedback: "again" });

    expect(events.map((e) => [e.seq, e.turnIndex, e.type])).toEqual([
      [0, 7, "turn_started"],
      [1, 7, "exit_retry"],
    ]);
    expect(seen).toEqual(events);
    expect(Number.isNaN(Date.parse(events[0].at))).toBe(false);
    expect(countRetries(events)).toBe(1);
  });

  it("propagates a listener error to the emitter after recording the event", () => {
    const later: string[] = [];
    const { sink, events } = createTurnEventLog(1, [
      () => {
        throw new Error("ui blew up");
      },
      (e) => {
        later.push(e.type);
      },
    ]);
    expect(() => sink.emit({ type: "turn_started", threadId: "t", prompt: null })).toThrow(
      "ui blew up"
    );
    expect(events.length).toBe(1);
    expect(later).toEqual([]);
  });

  it("produces events that round-trip through the persisted schema", () => {
    const { sink, events } = createTurnEventLog(3, []);
    sink.emit({
      type: "model_step",
      stepId: "s",
      content: "",
      toolCalls: [{ id: "c1", name: "ls", args: { a: 1 } }],
      durationMs: 5,
    });
    sink.emit({
      type: "governor_action",
      phase: "entry",
      interceptor: "Governor",
      action: {
        type: "push_intent",
        intent: {
          id: "i",
          kind: "request",
          description: "d",
          completed_when: null,
          overstep: null,
          specificity: null,
          changelog: [],
        },
      },
    });
    sink.emit({
      type: "context_files_loaded",
      agent: "teacher",
      hook: "preTool",
      files: [{ path: "/w/agents/tools.md", size: 3, missing: false, loadedAt: "t" }],
    });
    expect(events.map((e) => turnEventSchema.parse(e))).toEqual(events);
  });

  it("streams scoped events live but commits them as one segment on close", () => {
    const seen: string[] = [];
    const segments: TurnSegment[] = [];
    const { sink } = createTurnEventLog(
      1,
      [
        (e) => {
          seen.push(`${e.actor}:${e.type}`);
        },
      ],
      collect(segments)
    );
    sink.emit({ type: "turn_started", threadId: "t", prompt: "go" });
    const governor = sink.scope("Governor", { phase: "entry" });
    governor.emit({ type: "waiting", on: "Governor" });
    expect(segments.map((s) => s.actor)).toEqual(["worker"]);
    governor.emit({
      type: "governor_brief",
      interceptor: "Governor",
      text: "b",
      doneWhen: [],
    });
    governor.close();
    governor.close();

    expect(seen).toEqual([
      "worker:turn_started",
      "Governor-entry:waiting",
      "Governor-entry:governor_brief",
    ]);
    expect(segments.map((s) => [s.actor, s.isScope, s.events.map((e) => e.type)])).toEqual([
      ["worker", false, ["turn_started"]],
      ["Governor-entry", true, ["waiting", "governor_brief"]],
    ]);
    expect(() => governor.emit({ type: "paused" })).toThrow("after its scope closed");
  });

  it("collapses a scope into an interceptor_passed marker on its parent", () => {
    const segments: TurnSegment[] = [];
    const { sink, events } = createTurnEventLog(1, [], collect(segments));
    const teacher = sink.scope("ToolTeacher", { phase: "pre_tool" });
    teacher.emit({ type: "waiting", on: "ToolTeacher" });
    teacher.close({ collapse: true });

    expect(events.map((e) => e.type)).toEqual(["waiting", "interceptor_passed"]);
    expect(segments.map((s) => [s.actor, s.isScope, s.events.map((e) => e.type)])).toEqual([
      ["worker", false, ["interceptor_passed"]],
    ]);
    expect(segments[0].events[0]).toMatchObject({
      interceptor: "ToolTeacher",
      phase: "pre_tool",
    });
  });

  it("never collapses a scope that recorded an op", () => {
    const segments: TurnSegment[] = [];
    const { sink } = createTurnEventLog(1, [], collect(segments));
    const governor = sink.scope("Governor", { phase: "exit" });
    governor.emit({
      type: "governor_action",
      phase: "exit",
      interceptor: "Governor",
      action: { type: "begin_prompt" },
    });
    governor.close({ collapse: true });

    expect(segments.map((s) => [s.actor, s.events.map((e) => e.type)])).toEqual([
      ["Governor-exit", ["governor_action"]],
    ]);
  });

  it("commits nested and concurrent scopes in close order", () => {
    const segments: TurnSegment[] = [];
    const { sink, closeOpenScopes } = createTurnEventLog(1, [], collect(segments));
    const first = sink.scope("ToolTeacher", { phase: "pre_tool" });
    const second = sink.scope("ToolTeacher", { phase: "pre_tool" });
    const user = first.scope("user");
    first.emit({ type: "waiting", on: "first" });
    second.emit({ type: "waiting", on: "second" });
    user.emit({ type: "prompt_answered", promptId: "p", value: true });
    second.close();
    user.close();
    closeOpenScopes();

    expect(segments.map((s) => [s.actor, s.events.map((e) => e.seq)])).toEqual([
      ["ToolTeacher-pre_tool", [1]],
      ["user", [2]],
      ["ToolTeacher-pre_tool", [0]],
    ]);
  });

  it("formats trace lines", () => {
    const { sink, events } = createTurnEventLog(2, []);
    sink.emit({ type: "turn_started", threadId: "t", prompt: "go" });
    sink.emit({ type: "turn_completed", retries: 0, finalResponse: "ok" });
    sink.emit({ type: "turn_failed", error: "boom", aborted: false });
    sink.emit({
      type: "context_files_loaded",
      agent: "worker",
      hook: "session",
      files: [
        { path: "/r/worker.md", size: 1, missing: false, loadedAt: "t" },
        { path: "/w/AGENTS.md", size: 0, missing: true, loadedAt: "t" },
      ],
    });
    expect(events.map((e) => formatTraceLine(e))).toEqual([
      '[TURN_START] Turn 2: prompt="go"',
      "[TURN_SUCCESS] Turn 2 finished successfully (retries: 0).",
      "[TURN_ERROR] Turn 2 failed: boom",
      "[CONTEXT_FILES] worker session: /r/worker.md, /w/AGENTS.md (missing)",
    ]);
  });
});
