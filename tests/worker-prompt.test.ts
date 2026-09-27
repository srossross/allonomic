import { describe, it, expect } from "bun:test";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { loadWorkerPrompt } from "../src/agent/worker";

describe("loadWorkerPrompt", () => {
  it("appends agent files outermost first", async () => {
    const runtime = createMemoryRuntime();
    runtime.fs.files.set("/resources/app-data/prompts/worker.md", "template");
    runtime.fs.files.set("/a/AGENTS.md", "outer");
    runtime.fs.files.set("/a/b/AGENTS.md", "inner agents");
    runtime.fs.files.set("/a/b/CLAUDE.md", "inner claude");
    const prompt = await loadWorkerPrompt(runtime, "/a/b");
    expect(prompt).toBe(
      [
        "template",
        "# /a/AGENTS.md\n\nouter",
        "# /a/b/AGENTS.md\n\ninner agents",
        "# /a/b/CLAUDE.md\n\ninner claude",
      ].join("\n\n")
    );
  });
});
