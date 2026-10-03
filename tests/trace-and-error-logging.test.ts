import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createNodeRuntime } from "../src/adapters/node/runtime";
import { SESSION_LOG_FILE, SessionWriter } from "../src/core/graph/sessionWriter";
import { loadTurn, turnDirFor } from "../src/core/turn/turnFiles";
import { USER_ACTOR } from "../src/core/turn/events";
import { writeTurn } from "./helpers/turnWriter";

describe("session files on a real filesystem", () => {
  const { fs: store } = createNodeRuntime();
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "allonomic-telemetry-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("creates turn directories and appends segments for a failed turn", async () => {
    await writeTurn(store, tempDir, 2, (sink) => {
      const user = sink.scope(USER_ACTOR);
      user.emit({ type: "turn_started", threadId: "t", prompt: "Do an infinite loop" });
      user.close();
      sink.emit({ type: "turn_failed", error: "Recursion limit", aborted: false });
    });

    const turnDir = turnDirFor(tempDir, 2);
    const files = await fs.readdir(turnDir);
    expect(files.toSorted((a, b) => a.localeCompare(b))).toEqual([
      "001-user.jsonl",
      "002-worker.jsonl",
    ]);
    const events = await loadTurn(store, turnDir);
    expect(events.map((e) => [e.actor, e.type])).toEqual([
      ["user", "turn_started"],
      ["worker", "turn_failed"],
    ]);
  });

  it("appends app log records under logs/", async () => {
    const writer = new SessionWriter(
      store,
      () => tempDir,
      () => {}
    );
    writer.appendLog({ time: 1, level: 30, scope: "test", msg: "first" });
    writer.appendLog({ time: 2, level: 30, scope: "test", msg: "second" });
    await writer.flush();

    const content = await fs.readFile(path.join(tempDir, SESSION_LOG_FILE), "utf8");
    expect(
      content
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).msg)
    ).toEqual(["first", "second"]);
  });
});
