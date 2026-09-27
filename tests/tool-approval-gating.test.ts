import { describe, it, expect } from "bun:test";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { createAgentTools } from "../src/core/tools";
import { decodeToolResult } from "../src/core/userPrompt";

function writeTool(mode: "manual" | "accept edits", isApproved?: boolean) {
  const runtime = createMemoryRuntime();
  const tools = createAgentTools(runtime, "/w", mode, { approved: isApproved });
  const write = tools.find((t) => t.name === "write_file")!;
  const mutate = tools.find((t) => t.name === "run_mutating_command")!;
  return { runtime, write, mutate };
}

describe("tool approval gating", () => {
  it("manual mode: write_file returns a confirm prompt and writes nothing", async () => {
    const { runtime, write } = writeTool("manual");
    const result = await write.invoke({ filePath: "a.txt", content: "hello" });
    expect(decodeToolResult(result)).toEqual({
      status: "pending",
      prompt: { kind: "confirm", label: "Write a.txt", detail: "5 bytes" },
    });
    expect(runtime.fs.files.size).toBe(0);
  });

  it("manual mode + approved: write_file writes", async () => {
    const { runtime, write } = writeTool("manual", true);
    const result = await write.invoke({ filePath: "a.txt", content: "hello" });
    expect(decodeToolResult(result)).toEqual({ status: "executed" });
    expect(await runtime.fs.readText("/w/a.txt")).toBe("hello");
  });

  it("accept edits: write_file never prompts", async () => {
    const { runtime, write } = writeTool("accept edits");
    await write.invoke({ filePath: "a.txt", content: "hello" });
    expect(await runtime.fs.readText("/w/a.txt")).toBe("hello");
  });

  it("manual mode: run_mutating_command returns the command as the label", async () => {
    const { runtime, mutate } = writeTool("manual");
    runtime.shell = { execute: async () => ({ code: 0, stdout: "abc123\trunning\n", stderr: "" }) };
    const result = await mutate.invoke({ command: "go mod tidy" });
    expect(decodeToolResult(result)).toEqual({
      status: "pending",
      prompt: { kind: "confirm", label: "go mod tidy" },
    });
  });
});
