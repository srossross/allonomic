import { describe, it, expect } from "bun:test";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { loadWorkerPrompt } from "../src/agent/worker";

describe("loadWorkerPrompt", () => {
  it("appends user files then agent files outermost first", async () => {
    const runtime = createMemoryRuntime();
    runtime.fs.files.set("/resources/app-data/prompts/worker.md", "template");
    runtime.fs.files.set("/home/test/.allonomic/CLAUDE.md", "user claude");
    runtime.fs.files.set("/a/AGENTS.md", "outer");
    runtime.fs.files.set("/a/b/AGENTS.md", "inner agents");
    runtime.fs.files.set("/a/b/CLAUDE.md", "inner claude");
    const { prompt, files } = await loadWorkerPrompt(runtime, "/a/b");
    expect(prompt).toBe(
      [
        "template",
        "# /home/test/.allonomic/CLAUDE.md\n\nuser claude",
        "# /a/AGENTS.md\n\nouter",
        "# /a/b/AGENTS.md\n\ninner agents",
        "# /a/b/CLAUDE.md\n\ninner claude",
      ].join("\n\n")
    );
    expect(files.map((file) => [file.path, file.missing])).toEqual([
      ["/resources/app-data/prompts/worker.md", false],
      ["/home/test/.allonomic/AGENTS.md", true],
      ["/home/test/.allonomic/CLAUDE.md", false],
      ["/a/AGENTS.md", false],
      ["/a/b/AGENTS.md", false],
      ["/a/b/CLAUDE.md", false],
    ]);
  });

  it("falls back and flags the template when worker.md is missing", async () => {
    const runtime = createMemoryRuntime();
    const { prompt, files } = await loadWorkerPrompt(runtime, "/a");
    expect(prompt).toContain("expert software engineer");
    expect(files.map((file) => [file.path, file.missing])).toEqual([
      ["/resources/app-data/prompts/worker.md", true],
      ["/home/test/.allonomic/AGENTS.md", true],
      ["/home/test/.allonomic/CLAUDE.md", true],
      ["/a/AGENTS.md", true],
      ["/a/CLAUDE.md", true],
    ]);
  });
});
