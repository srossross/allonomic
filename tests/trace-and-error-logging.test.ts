import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import YAML from "yaml";
import { appendTraceLog, saveTurnError } from "../src/core/telemetry/session";
import { createNodeRuntime } from "../src/adapters/node/runtime";

describe("Telemetry Trace and Error Logging Flow", () => {
  const { fs: store } = createNodeRuntime();
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "allonomic-telemetry-test-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("appends timestamped entries to trace.log in real time", async () => {
    await appendTraceLog(store, tempDir, "First step initiated");
    await appendTraceLog(store, tempDir, "Second step completed");

    const logPath = path.join(tempDir, "trace.log");
    const content = await fs.readFile(logPath, "utf8");

    expect(content).toContain("First step initiated");
    expect(content).toContain("Second step completed");
    expect(content).toContain("[20");
  });

  it("saveTurnError persists error.yml and user.yml even on failed turns", async () => {
    const turnDir = await saveTurnError(store, tempDir, {
      turnIndex: 2,
      userPrompt: "Do an infinite loop",
      error: new Error("Recursion limit of 25 reached without hitting a stop condition."),
      events: [
        {
          seq: 0,
          at: "2026-01-01T00:00:00.000Z",
          turnIndex: 2,
          type: "turn_started",
          threadId: "t",
          prompt: "Do an infinite loop",
        },
        {
          seq: 1,
          at: "2026-01-01T00:00:01.000Z",
          turnIndex: 2,
          type: "turn_failed",
          error: "Recursion limit",
          aborted: false,
        },
      ],
    });

    // Check user.yml
    const userPath = path.join(turnDir, "user.yml");
    const userContent = await fs.readFile(userPath, "utf8");
    const userParsed = YAML.parse(userContent);
    expect(userParsed.prompt).toBe("Do an infinite loop");

    // Check error.yml
    const errorPath = path.join(turnDir, "error.yml");
    const errorContent = await fs.readFile(errorPath, "utf8");
    const errorParsed = YAML.parse(errorContent);

    expect(errorParsed.error).toContain("Recursion limit of 25 reached");

    const eventsParsed = YAML.parse(await fs.readFile(path.join(turnDir, "events.yml"), "utf8"));
    expect(eventsParsed.events.map((e: { type: string }) => e.type)).toEqual([
      "turn_started",
      "turn_failed",
    ]);

    // Check trace.log updated with [ERROR]
    const logPath = path.join(tempDir, "trace.log");
    const logContent = await fs.readFile(logPath, "utf8");
    expect(logContent).toContain("[ERROR] Turn 2 failed: Recursion limit of 25 reached");
  });
});
