import { describe, it, expect } from "bun:test";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { AgentRunner } from "../src/core/graph/runner";
import { rehydrateSession } from "../src/core/session/rehydration";
import { loadTurn, turnDirFor } from "../src/core/turn/turnFiles";
import { USER_ACTOR, type TurnEvent } from "../src/core/turn/events";
import {
  FailingOnceModel,
  FakeChatModel,
  toolCall,
  type ScriptedTurn,
} from "./helpers/fakeChatModel";
import { writeTurn } from "./helpers/turnWriter";

const SESSION_DIR = "/w/.allonomic/sessions/s1";

function runnerFor(
  runtime: ReturnType<typeof createMemoryRuntime>,
  script: ScriptedTurn[],
  turn = 1
) {
  return new AgentRunner({
    runtime,
    workspaceDir: "/w",
    sessionId: "s1",
    initialTurnIndex: turn,
    executionMode: "restricted",
    createModel: () => new FakeChatModel(script),
  });
}

async function writeCrashedTurn(runtime: ReturnType<typeof createMemoryRuntime>, hasStep = true) {
  await writeTurn(runtime.fs, SESSION_DIR, 1, (sink) => {
    const user = sink.scope(USER_ACTOR);
    user.emit({ type: "turn_started", threadId: "s1", prompt: "build" });
    user.close();
    if (!hasStep) return;
    sink.emit({
      type: "model_step",
      stepId: "s1-step",
      content: "",
      toolCalls: [{ id: "c1", name: "shell_4_full_access", args: { command: "make" } }],
      durationMs: 5,
    });
  });
}

async function eventTypes(runtime: ReturnType<typeof createMemoryRuntime>): Promise<string[]> {
  const events = await loadTurn(runtime.fs, turnDirFor(SESSION_DIR, 1));
  return events.map((e) => e.type);
}

function answering(runner: AgentRunner, choice: string, events: TurnEvent[] = []) {
  return (event: TurnEvent) => {
    events.push(event);
    if (event.type !== "prompt_requested") return;
    const answers: Record<string, string | boolean> = { choice, confirm: true };
    queueMicrotask(() => runner.answerPrompt(event.promptId, answers[event.prompt.kind]));
  };
}

describe("crash recovery", () => {
  it("appends events to disk while the turn is still running", async () => {
    const runtime = createMemoryRuntime();
    const runner = runnerFor(runtime, [
      { toolCalls: [toolCall("shell_4_full_access", { command: "make" }, "c1")] },
      "done",
    ]);
    let midTurn: Promise<string[]> = Promise.resolve([]);
    await runner.run("build", "s1", {
      onEvent: (event) => {
        if (event.type !== "prompt_requested") return;
        setTimeout(() => {
          midTurn = eventTypes(runtime);
          runner.answerPrompt(event.promptId, true);
        }, 5);
      },
    });
    expect(await midTurn).toContain("model_step");
    expect(await midTurn).not.toContain("turn_completed");
    expect(await eventTypes(runtime)).toContain("turn_completed");
  });

  it("closes an unfinished turn once and reports its unanswered calls", async () => {
    const runtime = createMemoryRuntime();
    await writeCrashedTurn(runtime);

    const first = await rehydrateSession(runtime.fs, "/w", "s1");
    expect(first.unansweredCalls.map((c) => c.id)).toEqual(["c1"]);
    expect(first.messages.at(-1)?.content).toBe("Error: The app shut down during this turn");
    const afterFirst = await eventTypes(runtime);
    expect(afterFirst.at(-1)).toBe("turn_failed");

    await rehydrateSession(runtime.fs, "/w", "s1");
    const afterSecond = await eventTypes(runtime);
    expect(afterSecond.filter((t) => t === "turn_failed")).toHaveLength(1);
  });

  it("re-run asks again for approval, runs the tool, and the agent continues", async () => {
    const runtime = createMemoryRuntime();
    await writeCrashedTurn(runtime);
    const session = await rehydrateSession(runtime.fs, "/w", "s1");
    const model = new FakeChatModel(["continued"]);
    const runner = new AgentRunner({
      runtime,
      workspaceDir: "/w",
      sessionId: "s1",
      initialTurnIndex: session.nextTurnIndex,
      executionMode: "restricted",
      createModel: () => model,
    });
    const events: TurnEvent[] = [];

    const result = await runner.recover("s1", session.unansweredCalls, {
      onEvent: answering(runner, "rerun", events),
    });

    expect(result.finalResponse).toBe("continued");
    const modelInput = model.calls[0].map((m) => m._getType());
    expect(modelInput).toEqual(["system", "human", "ai", "tool"]);
    expect(runtime.shell.calls).toHaveLength(1);
    const prompts = events.flatMap((e) => (e.type === "prompt_requested" ? [e.prompt.kind] : []));
    expect(prompts).toEqual(["choice", "confirm"]);
    const after = await rehydrateSession(runtime.fs, "/w", "s1");
    expect(after.unansweredCalls).toEqual([]);
  });

  it("skip closes the call without running it", async () => {
    const runtime = createMemoryRuntime();
    await writeCrashedTurn(runtime);
    const session = await rehydrateSession(runtime.fs, "/w", "s1");
    const runner = runnerFor(runtime, ["ok"], session.nextTurnIndex);
    const events: TurnEvent[] = [];

    await runner.recover("s1", session.unansweredCalls, {
      onEvent: answering(runner, "skip", events),
    });

    expect(runtime.shell.calls).toHaveLength(0);
    const result = events.find((e) => e.type === "tool_result");
    expect(result?.type === "tool_result" && result.content).toContain("Not run");
  });

  it("try again with no unanswered calls resumes a turn that crashed before any step", async () => {
    const runtime = createMemoryRuntime();
    await writeCrashedTurn(runtime, false);
    const session = await rehydrateSession(runtime.fs, "/w", "s1");
    const model = new FakeChatModel(["resumed"]);
    const runner = new AgentRunner({
      runtime,
      workspaceDir: "/w",
      sessionId: "s1",
      initialTurnIndex: session.nextTurnIndex,
      executionMode: "restricted",
      createModel: () => model,
    });

    const result = await runner.recover("s1", []);

    expect(session.nextTurnIndex).toBe(2);
    expect(result.finalResponse).toBe("resumed");
    expect(model.calls[0].map((m) => m._getType())).toEqual(["system", "human"]);
  });

  it("try again after a live failure resumes from the failed step", async () => {
    const runtime = createMemoryRuntime();
    const model = new FailingOnceModel(
      [{ toolCalls: [toolCall("shell_1_project_read_only", { command: "ls" }, "c1")] }, "done"],
      2
    );
    const runner = new AgentRunner({
      runtime,
      workspaceDir: "/w",
      sessionId: "s1",
      initialTurnIndex: 1,
      executionMode: "restricted",
      createModel: () => model,
    });
    await expect(runner.run("list", "s1")).rejects.toThrow("boom");
    await rehydrateSession(runtime.fs, "/w", "s1");

    const result = await runner.recover("s1", []);

    expect(result.finalResponse).toBe("done");
    expect(runtime.shell.calls).toHaveLength(1);
    expect(model.calls.at(-1)?.map((m) => m._getType())).toEqual(["system", "human", "ai", "tool"]);
  });

  it("calls closed by a failed turn are not reported as unanswered", async () => {
    const runtime = createMemoryRuntime();
    const runner = runnerFor(runtime, [
      { toolCalls: [toolCall("shell_1_project_read_only", { command: "ls" }, "c1")] },
    ]);
    await expect(runner.run("list", "s1")).rejects.toThrow("script exhausted");
    const session = await rehydrateSession(runtime.fs, "/w", "s1");
    expect(session.unansweredCalls).toEqual([]);
  });
});
