import { describe, it, expect } from "bun:test";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { AgentRunner } from "../src/core/graph/runner";
import type { TurnEvent, TurnEventOf } from "../src/core/turn/events";
import type { UserPromptValue } from "../src/types";
import { FakeChatModel, toolCall } from "./helpers/fakeChatModel";
import { answerPromptsWith, isYesFlag } from "../src/agent/cli/autoAnswer";

function fullAccessRunner(script: ConstructorParameters<typeof FakeChatModel>[0]) {
  const runtime = createMemoryRuntime();
  const runner = new AgentRunner({
    runtime,
    workspaceDir: "/w",
    sessionId: "s1",
    executionMode: "restricted",
    createModel: () => new FakeChatModel(script),
  });
  return { runtime, runner };
}

function answerOnPrompt(runner: AgentRunner, value: UserPromptValue, events: TurnEvent[]) {
  return (event: TurnEvent) => {
    events.push(event);
    if (event.type === "prompt_requested") {
      queueMicrotask(() => runner.answerPrompt(event.promptId, value));
    }
  };
}

describe("cli --yes/--no", () => {
  it("defaults to yes and rejects both flags", () => {
    expect(isYesFlag([])).toBe(true);
    expect(isYesFlag(["--yes"])).toBe(true);
    expect(isYesFlag(["--no"])).toBe(false);
    expect(() => isYesFlag(["--yes", "--no"])).toThrow("only one of");
  });

  it("answers confirm prompts with the flag", async () => {
    for (const [isYes, calls] of [
      [true, 1],
      [false, 0],
    ] as const) {
      const { runtime, runner } = fullAccessRunner([
        { toolCalls: [toolCall("shell_4_full_access", { command: "make" }, "c1")] },
        "done",
      ]);
      await runner.run("build", "t1", { onEvent: answerPromptsWith(runner, isYes) });
      expect(runtime.shell.calls).toHaveLength(calls);
    }
  });
});

describe("askUser in the runner", () => {
  it("waits for the answer and continues the same turn", async () => {
    const { runtime, runner } = fullAccessRunner([
      { toolCalls: [toolCall("shell_4_full_access", { command: "make" }, "c1")] },
      "built",
    ]);
    const events: TurnEvent[] = [];
    const result = await runner.run("build", "t1", {
      onEvent: answerOnPrompt(runner, true, events),
    });
    expect(result.finalResponse).toBe("built");
    expect(runtime.shell.calls).toHaveLength(1);
    const requested = events.find(
      (e): e is TurnEventOf<"prompt_requested"> => e.type === "prompt_requested"
    );
    expect(requested).toMatchObject({
      toolCallId: "c1",
      prompt: { kind: "confirm", label: "make" },
    });
    expect(events.map((e) => e.type)).toContain("prompt_answered");
  });

  it("a declined answer does not run the tool", async () => {
    const { runtime, runner } = fullAccessRunner([
      { toolCalls: [toolCall("shell_4_full_access", { command: "make" }, "c1")] },
      "skipped",
    ]);
    const result = await runner.run("build", "t1", {
      onEvent: answerOnPrompt(runner, false, []),
    });
    expect(result.finalResponse).toBe("skipped");
    expect(runtime.shell.calls).toHaveLength(0);
  });

  it("aborting while waiting stops the turn", async () => {
    const { runtime, runner } = fullAccessRunner([
      { toolCalls: [toolCall("shell_4_full_access", { command: "make" }, "c1")] },
      "never",
    ]);
    const run = runner.run("build", "t1", {
      onEvent: (event) => {
        if (event.type === "prompt_requested") queueMicrotask(() => runner.abort("t1"));
      },
    });
    await expect(run).rejects.toThrow();
    expect(runtime.shell.calls).toHaveLength(0);
    expect(() => runner.answerPrompt("missing", true)).toThrow("No pending prompt missing");
  });

  it("a stop during a prompt fails the turn as stopped instead of becoming tool output", async () => {
    const { runner } = fullAccessRunner([
      { toolCalls: [toolCall("shell_4_full_access", { command: "make" }, "c1")] },
      "never",
    ]);
    const events: TurnEvent[] = [];
    const run = runner.run("build", "t1", {
      onEvent: (event) => {
        events.push(event);
        if (event.type === "prompt_requested") queueMicrotask(() => runner.abort("t1"));
      },
    });
    await expect(run).rejects.toThrow();
    const toolOutputs = events.flatMap((e) => (e.type === "tool_result" ? [e.content] : []));
    expect(toolOutputs.some((content) => content.startsWith("Error executing"))).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "turn_failed", aborted: true });
  });
});
