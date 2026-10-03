import { describe, it, expect } from "bun:test";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import type { FileStore } from "../src/core/ports";
import {
  rehydrateSession,
  replayGovernorState,
  replaySession,
} from "../src/core/session/rehydration";
import { loadTurn, turnDirFor } from "../src/core/turn/turnFiles";
import { USER_ACTOR, type TurnEventSink } from "../src/core/turn/events";
import { writeTurn } from "./helpers/turnWriter";

const WORKSPACE = "/w";
const SESSION = "s1";
const SESSION_DIR = `${WORKSPACE}/.allonomic/sessions/${SESSION}`;

function listFilesTurn(sink: TurnEventSink) {
  const user = sink.scope(USER_ACTOR);
  user.emit({ type: "turn_started", threadId: "t", prompt: "list files" });
  user.close();
  const entry = sink.scope("Governor", { phase: "entry" });
  entry.emit({
    type: "governor_action",
    phase: "entry",
    interceptor: "Governor",
    action: {
      type: "push_intent",
      intent: {
        id: "itnt_new",
        kind: "request",
        description: "list",
        completed_when: null,
        overstep: null,
        specificity: null,
        changelog: [],
      },
    },
  });
  entry.close();
  sink.emit({
    type: "model_step",
    stepId: "s-new",
    content: "",
    toolCalls: [{ id: "c9", name: "list_files", args: {} }],
    durationMs: 3,
  });
  const teacher = sink.scope("ToolTeacher", { phase: "pre_tool" });
  teacher.emit({ type: "waiting", on: "ToolTeacher" });
  teacher.close({ collapse: true });
  sink.emit({ type: "tool_result", toolCallId: "c9", name: "list_files", content: "a.txt" });
  sink.emit({
    type: "model_step",
    stepId: "s-new-2",
    content: "a.txt",
    toolCalls: [],
    durationMs: 3,
  });
  const exit = sink.scope("Governor", { phase: "exit" });
  exit.emit({
    type: "governor_action",
    phase: "exit",
    interceptor: "Governor",
    action: { type: "resolve_intent", id: "itnt_new" },
  });
  exit.close();
  sink.emit({ type: "turn_completed", retries: 0, finalResponse: "a.txt" });
}

async function segmentNames(fs: FileStore, turnIndex: number): Promise<string[]> {
  const entries = await fs.readDir(turnDirFor(SESSION_DIR, turnIndex));
  return entries.map((e) => e.name).toSorted((a, b) => a.localeCompare(b));
}

describe("turn persistence", () => {
  it("writes one numbered jsonl file per actor handoff and loads back in seq order", async () => {
    const { fs } = createMemoryRuntime();
    const events = await writeTurn(fs, SESSION_DIR, 4, listFilesTurn);

    expect(await segmentNames(fs, 4)).toEqual([
      "001-user.jsonl",
      "002-governor-entry.jsonl",
      "003-worker.jsonl",
      "004-governor-exit.jsonl",
      "005-worker.jsonl",
    ]);
    const worker = await fs.readText(`${turnDirFor(SESSION_DIR, 4)}/003-worker.jsonl`);
    expect(
      worker
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).type)
    ).toEqual(["model_step", "interceptor_passed", "tool_result", "model_step"]);

    const loaded = await loadTurn(fs, turnDirFor(SESSION_DIR, 4));
    expect(loaded).toEqual(events.filter((e) => e.type !== "waiting"));
  });

  it("drops a torn final line but rejects a corrupt line elsewhere", async () => {
    const { fs } = createMemoryRuntime();
    await writeTurn(fs, SESSION_DIR, 1, listFilesTurn);
    const dir = turnDirFor(SESSION_DIR, 1);
    await fs.writeText(`${dir}/005-worker.jsonl`, '{"seq":99,"ty', { append: true });
    const loaded = await loadTurn(fs, dir);
    expect(loaded.at(-1)?.type).toBe("turn_completed");

    await fs.writeText(`${dir}/001-user.jsonl`, "not json\n", { append: true });
    await expect(loadTurn(fs, dir)).rejects.toThrow("001-user.jsonl line 2");
  });

  it("rehydrates completed and failed turns", async () => {
    const { fs } = createMemoryRuntime();
    await writeTurn(fs, SESSION_DIR, 1, listFilesTurn);
    await writeTurn(fs, SESSION_DIR, 2, (sink) => {
      const user = sink.scope(USER_ACTOR);
      user.emit({ type: "turn_started", threadId: "t", prompt: "loop" });
      user.close();
      sink.emit({ type: "turn_failed", error: "Recursion limit", aborted: false });
    });

    const session = await rehydrateSession(fs, WORKSPACE, SESSION);
    expect(session.nextTurnIndex).toBe(3);
    expect(session.loadErrors).toEqual([]);
    expect(session.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(session.messages.at(-1)?.content).toBe("Error: Recursion limit");
    expect(session.governorState.completed_intents.map((i) => i.id)).toEqual(["itnt_new"]);

    const replay = await replaySession(fs, SESSION_DIR);
    expect(replayGovernorState(replay.events)).toEqual(session.governorState);
    expect(replay.nextTurnIndex).toBe(3);
  });

  it("reports a turn without segments as a load error and still loads the rest", async () => {
    const { fs } = createMemoryRuntime();
    await fs.mkdir(turnDirFor(SESSION_DIR, 1));
    await writeTurn(fs, SESSION_DIR, 2, listFilesTurn);

    const session = await rehydrateSession(fs, WORKSPACE, SESSION);
    expect(session.loadErrors).toHaveLength(1);
    expect(session.loadErrors[0].turnIndex).toBe(1);
    expect(session.messages.map((m) => m.role)).toEqual(["user", "assistant", "assistant"]);
    expect(session.nextTurnIndex).toBe(3);
  });
});
