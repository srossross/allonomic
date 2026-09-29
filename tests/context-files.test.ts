import { describe, it, expect } from "bun:test";
import { classifyPath } from "../src/core/contextFiles";

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
