import { describe, it, expect } from "bun:test";
import { MemoryFileStore, createMemoryRuntime } from "../src/adapters/memory/runtime";
import { AgentRunner } from "../src/core/graph/runner";
import { readContextFile } from "../src/core/contextFiles";
import { loadSessionMetadata } from "../src/core/session/metadata";
import type { TurnEvent } from "../src/core/turn/events";
import { FakeChatModel } from "./helpers/fakeChatModel";

class FailingStore extends MemoryFileStore {
  constructor(private readonly failingSuffix: string) {
    super();
  }

  override async writeText(path: string, content: string, options?: { append?: boolean }) {
    if (path.endsWith(this.failingSuffix)) throw new Error(`disk full: ${path}`);
    await super.writeText(path, content, options);
  }

  override async readText(path: string): Promise<string> {
    if (path.endsWith(this.failingSuffix)) throw new Error(`permission denied: ${path}`);
    return await super.readText(path);
  }
}

function runnerWith(fs: MemoryFileStore) {
  const runtime = { ...createMemoryRuntime(), fs };
  return new AgentRunner({
    runtime,
    workspaceDir: "/w",
    sessionId: "s1",
    executionMode: "restricted",
    createModel: () => new FakeChatModel(["done"]),
  });
}

describe("session writes", () => {
  it("fails the turn when events.yml cannot be written", async () => {
    const events: TurnEvent[] = [];
    const run = runnerWith(new FailingStore("events.yml")).run("hi", "t1", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    await expect(run).rejects.toThrow("disk full");
    expect(events.map((e) => e.type)).toContain("turn_failed");
    expect(events.map((e) => e.type)).not.toContain("turn_completed");
  });

  it("warns once and completes the turn when trace.log cannot be written", async () => {
    const events: TurnEvent[] = [];
    const result = await runnerWith(new FailingStore("trace.log")).run("hi", "t1", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(result.finalResponse).toBe("done");
    const warnings = events.filter((e) => e.type === "warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ source: "trace.log" });
  });
});

describe("not-found handling", () => {
  it("readContextFile marks a missing file and rethrows other read errors", async () => {
    const runtime = { ...createMemoryRuntime(), fs: new FailingStore("locked.md") };
    expect(await readContextFile(runtime, "/nope.md")).toMatchObject({ missing: true });
    await expect(readContextFile(runtime, "/locked.md")).rejects.toThrow("permission denied");
  });

  it("loadSessionMetadata returns null when missing and rethrows other errors", async () => {
    expect(await loadSessionMetadata(new MemoryFileStore(), "/w", "s1")).toBeNull();
    const locked = new FailingStore("metadata.yml");
    await expect(loadSessionMetadata(locked, "/w", "s1")).rejects.toThrow("permission denied");
  });
});
