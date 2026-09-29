import { describe, it, expect } from "bun:test";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { createAgentTools } from "../src/core/tools";
import { decodeToolResult } from "../src/core/userPrompt";
import type { ExecutionMode, UserPrompt, UserPromptValue } from "../src/types";
import { recordingContext } from "./helpers/turnContext";
import type { ExecutionModeSource } from "../src/core/tools/approval";

function agentTools(mode: ExecutionModeSource, answer: UserPromptValue = true) {
  const runtime = createMemoryRuntime();
  const prompts: UserPrompt[] = [];
  const { context } = recordingContext("t1", 1, async (prompt) => {
    prompts.push(prompt);
    return answer;
  });
  const config = { configurable: { context } };
  const tools = createAgentTools(runtime, "/w", mode);
  const invoker = (name: string) => {
    const t = tools.find((candidate) => candidate.name === name)!;
    return (args: Record<string, unknown>) => t.invoke(args, config);
  };
  return {
    runtime,
    prompts,
    read: invoker("read_file"),
    write: invoker("write_file"),
    list: invoker("list_files"),
    shells: [1, 2, 3, 4].map((level) =>
      invoker(tools.find((t) => t.name.startsWith(`shell_${level}_`))!.name)
    ),
  };
}

describe("tool approval gating", () => {
  it("asks for shells above the mode's level", async () => {
    const expected: Array<[ExecutionMode, number]> = [
      ["restricted", 3],
      ["read", 2],
      ["write", 1],
      ["god", 0],
    ];
    for (const [mode, count] of expected) {
      const { shells, prompts } = agentTools(mode);
      for (const shell of shells) await shell({ command: "ls" });
      expect(prompts).toHaveLength(count);
    }
  });

  it("reads the current mode when deciding whether to ask", async () => {
    let mode: ExecutionMode = "read";
    const { shells, prompts } = agentTools(async () => mode);
    await shells[2]({ command: "make" });
    expect(prompts).toHaveLength(1);
    mode = "write";
    await shells[2]({ command: "make" });
    expect(prompts).toHaveLength(1);
  });

  it("a declined prompt rejects without running", async () => {
    const { shells, runtime } = agentTools("restricted", false);
    const result = await shells[3]({ command: "make" });
    expect(decodeToolResult(result)).toEqual({ status: "rejected" });
    expect(runtime.shell.calls).toHaveLength(0);
  });

  it("an accepted prompt runs the tool", async () => {
    const { shells, runtime } = agentTools("restricted", true);
    await shells[3]({ command: "make" });
    expect(runtime.shell.calls).toHaveLength(1);
  });

  it("write_file in the project is level 3", async () => {
    const readMode = agentTools("read", false);
    const result = await readMode.write({ filePath: "a.txt", content: "hello" });
    expect(decodeToolResult(result)).toEqual({ status: "rejected" });
    expect(readMode.prompts).toEqual([
      {
        kind: "confirm",
        label: "Write a.txt",
        detail: "5 bytes",
        mode: "write",
        currentMode: "read",
      },
    ]);
    expect(readMode.runtime.fs.files.has("/w/a.txt")).toBe(false);

    const writeMode = agentTools("write");
    await writeMode.write({ filePath: "a.txt", content: "hello" });
    expect(writeMode.prompts).toHaveLength(0);
    expect(await writeMode.runtime.fs.readText("/w/a.txt")).toBe("hello");
  });

  it("write_file to a cache path is level 2", async () => {
    const { write, prompts } = agentTools("read");
    await write({ filePath: "/home/test/.npm/x", content: "x" });
    expect(prompts).toHaveLength(0);
  });

  it("read_file level follows the path", async () => {
    const { runtime, read, prompts } = agentTools("restricted", false);
    runtime.fs.files.set("/w/a.txt", "a");
    expect(await read({ filePath: "a.txt" })).toBe("a");
    await read({ filePath: "/etc/hosts" });
    await read({ filePath: "../other/x" });
    expect(prompts).toHaveLength(2);
  });

  it("denied paths are level 4", async () => {
    const { read, write, list, prompts } = agentTools("write", false);
    await read({ filePath: ".allonomic/x" });
    await write({ filePath: ".allonomic/x", content: "" });
    await list({ directory: ".allonomic" });
    expect(prompts).toHaveLength(3);
  });
});
