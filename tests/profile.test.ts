import { describe, it, expect } from "bun:test";
import type { TurnEvent, TurnEventBody } from "../src/core/turn/events";
import { applyProfileEvent, EMPTY_PROFILE } from "../src/core/turn/profile";

function fold(timeline: Array<[number, TurnEventBody]>) {
  const events = timeline.map(([atMs, body], seq): TurnEvent => ({
    ...body,
    seq,
    turnIndex: 1,
    at: new Date(atMs).toISOString(),
  }));
  let profile = EMPTY_PROFILE;
  for (const event of events) profile = applyProfileEvent(profile, event);
  return profile;
}

const spansOf = (profile: ReturnType<typeof fold>) =>
  profile.spans.map((s) => [s.source, s.on, s.durationMs]);

describe("profile", () => {
  it("times each wait until its end marker and resumes a tool after a user prompt", () => {
    const profile = fold([
      [0, { type: "turn_started", threadId: "t", prompt: "go" }],
      [0, { type: "waiting", on: "Governor · entry.md", source: "Governor", hook: "onUserPrompt" }],
      [2000, { type: "governor_fork", interceptor: "Governor", pass: "entry.md", messages: [] }],
      [2000, { type: "waiting", on: "Worker model", source: "worker" }],
      [5000, { type: "model_step", stepId: "s", content: "", toolCalls: [], durationMs: 3000 }],
      [5000, { type: "waiting", on: "Running shell_3_project_write", source: "tool" }],
      [
        5500,
        {
          type: "prompt_requested",
          promptId: "p",
          prompt: { kind: "confirm", label: "make" },
        },
      ],
      [9500, { type: "prompt_answered", promptId: "p", value: true }],
      [10_500, { type: "tool_result", toolCallId: "c", name: "shell", content: "ok" }],
      [11_000, { type: "turn_completed", retries: 0, finalResponse: "" }],
    ]);

    expect(spansOf(profile)).toEqual([
      ["Governor", "Governor · entry.md", 2000],
      ["worker", "Worker model", 3000],
      ["tool", "Running shell_3_project_write", 500],
      ["user", "make", 4000],
      ["tool", "Running shell_3_project_write", 1000],
    ]);
    expect(profile.turns).toEqual([{ turnIndex: 1, startMs: 0, endMs: 11_000, hasWaiting: true }]);
    expect(profile.spans.map((s) => s.hook)).toEqual([
      "onUserPrompt",
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("falls back to model_step and shell footer durations for turns without waiting events", () => {
    const profile = fold([
      [0, { type: "turn_started", threadId: "t", prompt: "go" }],
      [4000, { type: "model_step", stepId: "s", content: "", toolCalls: [], durationMs: 4000 }],
      [
        6000,
        { type: "tool_result", toolCallId: "c", name: "shell", content: "ok\n[exit 0 in 1500ms]" },
      ],
      [6000, { type: "turn_completed", retries: 0, finalResponse: "" }],
    ]);

    expect(spansOf(profile)).toEqual([
      ["worker", "Worker model", 4000],
      ["tool", "Running shell", 1500],
    ]);
  });
});
