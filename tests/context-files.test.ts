import { describe, it, expect } from "bun:test";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { classifyPath, readContextFile, toContextFiles } from "../src/core/contextFiles";

const roots = {
  app: "/Applications/Allonomic.app/Contents/Resources/app-data",
  user: "/Users/me",
  ws: "/Users/me/code/proj/",
};

describe("classifyPath", () => {
  it("labels each root and prefers the most specific", () => {
    expect(
      [
        "/Applications/Allonomic.app/Contents/Resources/app-data/prompts/worker.md",
        "/Users/me/code/proj/agents/tools.md",
        "/Users/me/code/CLAUDE.md",
        "/etc/CLAUDE.md",
      ].map((path) => classifyPath(path, roots))
    ).toEqual([
      { origin: "app", relative: "prompts/worker.md" },
      { origin: "ws", relative: "agents/tools.md" },
      { origin: "user", relative: "code/CLAUDE.md" },
      { origin: "/", relative: "/etc/CLAUDE.md" },
    ]);
  });

  it("does not match a sibling directory sharing a prefix", () => {
    expect(classifyPath("/Users/meow/CLAUDE.md", roots).origin).toBe("/");
  });
});

describe("readContextFile", () => {
  it("records the sha256 of a loaded file and none for a missing one", async () => {
    const runtime = createMemoryRuntime();
    await runtime.fs.writeText("/w/CLAUDE.md", "abc");

    const [loaded, missing] = await Promise.all([
      readContextFile(runtime, "/w/CLAUDE.md"),
      readContextFile(runtime, "/w/AGENTS.md"),
    ]);

    expect(toContextFiles([loaded, missing]).map((f) => f.sha256)).toEqual([
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      undefined,
    ]);
  });
});
