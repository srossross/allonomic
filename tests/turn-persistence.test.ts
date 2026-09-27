import { describe, it, expect } from "bun:test";
import YAML from "yaml";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { saveTurn, saveTurnError, turnDirFor } from "../src/core/telemetry/session";
import { resumeFromDir } from "../src/core/telemetry/sessionReplay";
import { rehydrateSession } from "../src/core/session/rehydration";
import { loadTurn } from "../src/core/turn/turnFiles";
import { createTurnEventLog } from "../src/core/turn/eventLog";
import { createPendingResult } from "../src/core/userPrompt";

const WORKSPACE = "/w";
const SESSION = "s1";
const SESSION_DIR = `${WORKSPACE}/.allonomic/sessions/${SESSION}`;

function newTurnEvents(turnIndex: number) {
  const { sink, events } = createTurnEventLog(turnIndex, []);
  sink.emit({ type: "turn_started", threadId: "t", prompt: "list files" });
  sink.emit({
    type: "governor_action",
    phase: "entry",
    interceptor: "Governor",
    action: {
      type: "push_intent",
      intent: { id: "itnt_new", kind: "request", description: "list", constraints: [] },
    },
  });
  sink.emit({
    type: "model_step",
    stepId: "s-new",
    content: "",
    toolCalls: [{ id: "c9", name: "list_files", args: {} }],
    durationMs: 3,
  });
  sink.emit({ type: "tool_result", toolCallId: "c9", name: "list_files", content: "a.txt" });
  sink.emit({
    type: "model_step",
    stepId: "s-new-2",
    content: "a.txt",
    toolCalls: [],
    durationMs: 3,
  });
  sink.emit({
    type: "governor_action",
    phase: "exit",
    interceptor: "Governor",
    action: { type: "resolve_intent", id: "itnt_new" },
  });
  sink.emit({ type: "turn_completed", retries: 0, finalResponse: "a.txt" });
  return events;
}

async function writeLegacyTurn(fs: ReturnType<typeof createMemoryRuntime>["fs"]) {
  const dir = turnDirFor(SESSION_DIR, 1);
  const at = "2026-01-01T00:00:00.000Z";
  await fs.writeText(`${dir}/user.yml`, YAML.stringify({ prompt: "delete x", timestamp: at }));
  await fs.writeText(
    `${dir}/agent.yml`,
    YAML.stringify({
      final_response: "Waiting for user: rm x",
      messages: [
        { type: "human", content: "delete x" },
        {
          type: "ai",
          content: "",
          thinking: "legacy thought",
          tool_calls: [{ id: "c1", name: "run_mutating_command", args: { command: "rm x" } }],
        },
        {
          type: "tool",
          name: "run_mutating_command",
          content: createPendingResult({ kind: "confirm", label: "rm x" }),
          tool_call_id: "c1",
        },
      ],
      timestamp: at,
    })
  );
  await fs.writeText(
    `${dir}/interceptors/entry.yml`,
    YAML.stringify({
      tool_calls: [
        { name: "push_intent", args: { id: "itnt_old", kind: "request", description: "delete" } },
        { name: "finish", args: {} },
      ],
      timestamp: at,
    })
  );
  await fs.writeText(
    `${dir}/interceptors/pre_tools.yml`,
    YAML.stringify([{ tool: "run_mutating_command", approved: true }])
  );
}

describe("turn persistence", () => {
  it("saveTurn writes events.yml that loads back identically", async () => {
    const { fs } = createMemoryRuntime();
    const events = newTurnEvents(4);
    const turnDir = await saveTurn(fs, SESSION_DIR, {
      turnIndex: 4,
      userPrompt: "list files",
      agentResponse: "a.txt",
      agentMessages: [new HumanMessage("list files"), new AIMessage("a.txt")],
      events,
    });
    expect(await fs.exists(`${turnDir}/interceptors`)).toBe(false);
    const loaded = await loadTurn(fs, turnDir, 4, 0);
    expect(loaded.events).toEqual(events);
  });

  it("synthesizes events for a legacy turn directory", async () => {
    const { fs } = createMemoryRuntime();
    await writeLegacyTurn(fs);
    const { events, messageCount } = await loadTurn(fs, turnDirFor(SESSION_DIR, 1), 1, 0);
    expect(messageCount).toBe(3);
    expect(events.map((e) => e.type)).toEqual([
      "turn_started",
      "governor_action",
      "governor_verdict",
      "model_step",
      "governor_tool_decision",
      "tool_result",
      "turn_completed",
    ]);
    expect(events.every((e, i) => e.seq === i && e.turnIndex === 1)).toBe(true);
  });

  it("rehydrates a session mixing legacy, new and failed turns", async () => {
    const { fs } = createMemoryRuntime();
    await writeLegacyTurn(fs);
    await saveTurn(fs, SESSION_DIR, {
      turnIndex: 2,
      userPrompt: "list files",
      agentResponse: "a.txt",
      agentMessages: [],
      events: newTurnEvents(2),
    });
    const failed = createTurnEventLog(3, []);
    failed.sink.emit({ type: "turn_started", threadId: "t", prompt: "loop" });
    failed.sink.emit({ type: "turn_failed", error: "Recursion limit", aborted: false });
    await saveTurnError(fs, SESSION_DIR, {
      turnIndex: 3,
      userPrompt: "loop",
      error: new Error("Recursion limit"),
      events: failed.events,
    });

    const session = await rehydrateSession(fs, WORKSPACE, SESSION);
    expect(session.nextTurnIndex).toBe(4);
    expect(session.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(session.messages[1].toolCalls?.[0]).toMatchObject({ id: "c1", status: "pending" });
    expect(session.messages.at(-1)?.content).toBe("Error: Recursion limit");
    expect(session.governorState.intent_stack.map((i) => i.id)).toEqual(["itnt_old"]);
    expect(session.governorState.completed_intents.map((i) => i.id)).toEqual(["itnt_new"]);
    expect(session.consoleEvents.some((e) => e.badge === "ERROR")).toBe(true);

    const replay = await resumeFromDir(fs, SESSION_DIR);
    expect(replay.governorState).toEqual(session.governorState);
    expect(replay.nextTurnIndex).toBe(4);
  });

  it("resumeFromDir forks turns into a new directory", async () => {
    const { fs } = createMemoryRuntime();
    await saveTurn(fs, SESSION_DIR, {
      turnIndex: 1,
      userPrompt: "list files",
      agentResponse: "a.txt",
      agentMessages: [],
      events: newTurnEvents(1),
    });
    await saveTurn(fs, SESSION_DIR, {
      turnIndex: 2,
      userPrompt: "list files",
      agentResponse: "a.txt",
      agentMessages: [],
      events: newTurnEvents(2),
    });
    const fork = await resumeFromDir(fs, SESSION_DIR, "/w/fork", 1);
    expect(fork.nextTurnIndex).toBe(2);
    expect(fork.messages.map((m) => m._getType())).toEqual(["human", "ai"]);
    expect(await fs.exists(`${turnDirFor("/w/fork", 1)}/events.yml`)).toBe(true);
    expect(await fs.exists(turnDirFor("/w/fork", 2))).toBe(false);
  });

  it("slices legacy agent.yml whole-thread history to the turn", async () => {
    const { fs } = createMemoryRuntime();
    const dir = turnDirFor(SESSION_DIR, 2);
    await fs.writeText(
      `${dir}/user.yml`,
      YAML.stringify({ prompt: "second", timestamp: "2026-01-01T00:00:00.000Z" })
    );
    await fs.writeText(
      `${dir}/agent.yml`,
      YAML.stringify({
        final_response: "two",
        messages: [
          { type: "human", content: "first" },
          { type: "ai", content: "one" },
          { type: "human", content: "second" },
          { type: "ai", content: "two" },
        ],
      })
    );
    const { events } = await loadTurn(fs, dir, 2, 2);
    const steps = events.filter((e) => e.type === "model_step");
    expect(steps.map((e) => (e.type === "model_step" ? e.content : ""))).toEqual(["two"]);
  });

  it("serializes tool messages into turn-scoped agent.yml", async () => {
    const { fs } = createMemoryRuntime();
    const turnDir = await saveTurn(fs, SESSION_DIR, {
      turnIndex: 1,
      userPrompt: "x",
      agentResponse: "",
      agentMessages: [new ToolMessage({ content: "r", tool_call_id: "c1", name: "t" })],
      events: [],
    });
    const agent = YAML.parse(await fs.readText(`${turnDir}/agent.yml`));
    expect(agent.messages).toEqual([{ type: "tool", name: "t", content: "r", tool_call_id: "c1" }]);
  });
});
