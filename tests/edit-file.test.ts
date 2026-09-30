import { describe, it, expect } from "bun:test";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { createAgentTools } from "../src/core/tools";
import { decodeToolResult } from "../src/core/userPrompt";
import type { ExecutionMode, UserPrompt } from "../src/types";
import { recordingContext } from "./helpers/turnContext";

function editTool(mode: ExecutionMode, isApproved = true) {
  const runtime = createMemoryRuntime();
  const prompts: UserPrompt[] = [];
  const { context } = recordingContext("t1", 1, async (prompt) => {
    prompts.push(prompt);
    return isApproved;
  });
  const tool = createAgentTools(runtime, "/w", mode).find((t) => t.name === "edit_file")!;
  const edit = (args: Record<string, unknown>) => tool.invoke(args, { configurable: { context } });
  return { runtime, prompts, edit };
}

describe("edit_file", () => {
  it("replaces a unique match and reports its start line", async () => {
    const { runtime, edit } = editTool("write");
    runtime.fs.files.set("/w/a.ts", "one\ntwo\nthree\n");
    const result = await edit({ filePath: "a.ts", oldString: "two\nthree", newString: "2\n3" });
    expect(result).toBe("Successfully made 1 replacement in a.ts at line 2");
    expect(await runtime.fs.readText("/w/a.ts")).toBe("one\n2\n3\n");
  });

  it("rejects multiple matches without replaceAll", async () => {
    const { runtime, edit } = editTool("write");
    runtime.fs.files.set("/w/a.ts", "x\ny\nx\n");
    const result = await edit({ filePath: "a.ts", oldString: "x", newString: "z" });
    expect(result).toContain("found 2 times");
    expect(await runtime.fs.readText("/w/a.ts")).toBe("x\ny\nx\n");
  });

  it("replaceAll reports every start line", async () => {
    const { runtime, edit } = editTool("write");
    runtime.fs.files.set("/w/a.ts", "x\ny\nx\n");
    const result = await edit({
      filePath: "a.ts",
      oldString: "x",
      newString: "z",
      replaceAll: true,
    });
    expect(result).toBe("Successfully made 2 replacements in a.ts at lines 1, 3");
    expect(await runtime.fs.readText("/w/a.ts")).toBe("z\ny\nz\n");
  });

  it("errors when oldString is missing", async () => {
    const { runtime, edit } = editTool("write");
    runtime.fs.files.set("/w/a.ts", "x\n");
    expect(await edit({ filePath: "a.ts", oldString: "q", newString: "z" })).toContain(
      "oldString not found"
    );
  });

  it("a declined prompt leaves the file unchanged", async () => {
    const { runtime, prompts, edit } = editTool("read", false);
    runtime.fs.files.set("/w/a.ts", "x\n");
    const result = await edit({ filePath: "a.ts", oldString: "x", newString: "z" });
    expect(decodeToolResult(result)).toEqual({ status: "rejected" });
    expect(prompts).toHaveLength(1);
    expect(await runtime.fs.readText("/w/a.ts")).toBe("x\n");
  });
});
