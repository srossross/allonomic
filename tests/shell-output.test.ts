import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { createMemoryRuntime, ScriptedShell } from "../src/adapters/memory/runtime";
import { createAgentTools } from "../src/core/tools";
import { parseShellResult } from "../src/core/tools/shellResult";
import { INLINE_OUTPUT_LIMIT } from "../src/core/tools/shellLimits";
import { shellOutputPath } from "../src/core/tools/shellOutput";

const BIG = Array.from({ length: 600 }, (_, index) => `line ${index + 1}`).join("\n");

async function setup(options: { reply?: string; filtered?: string } = {}) {
  const runtime = createMemoryRuntime();
  const shell = new ScriptedShell((program) => ({
    code: 0,
    stdout: program === "sandbox-exec" ? (options.filtered ?? "") : currentOutput.value,
    stderr: "",
  }));
  const currentOutput = { value: BIG };
  runtime.shell = shell;
  await runtime.fs.writeText(
    "/resources/app-data/prompts/shell_reader/reader.md",
    readFileSync("app-data/prompts/shell_reader/reader.md", "utf8")
  );
  await runtime.fs.writeText(
    "/resources/app-data/models.yml",
    readFileSync("app-data/models.yml", "utf8")
  );
  const prompts: string[] = [];
  const tools = createAgentTools(runtime, "/w", "god", {
    createShellReaderModel: () => ({
      invoke: async (messages: BaseMessage[]) => {
        prompts.push(String(messages[0].content));
        return new AIMessage(options.reply ?? "");
      },
    }),
  });
  const find = (name: string) => tools.find((t) => t.name === name)!;
  return {
    runtime,
    shell,
    prompts,
    currentOutput,
    shell4: find("shell_4_full_access"),
    read: find("read_shell"),
  };
}

describe("shell output", () => {
  it("returns small output unchanged and stores it", async () => {
    const { runtime, shell4, currentOutput } = await setup();
    currentOutput.value = "a\nb\n";
    const result = String(await shell4.invoke({ command: "ls" }));
    expect(result).toMatch(/^a\nb\n\[exit 0 in \d+ms\]$/);
    const path = await shellOutputPath(runtime, "/w", undefined, "local-1");
    expect(await runtime.fs.readText(path)).toBe(result);
  });

  it("shows a header, head and tail, and keeps the footer for large output", async () => {
    const { runtime, shell4 } = await setup();
    const result = String(await shell4.invoke({ command: "find ." }));
    const lines = result.split("\n");
    expect(lines[0]).toMatch(
      /^\[output: 601 lines, \d+ chars; stored as local-1; read_shell to see more\]$/
    );
    expect(lines[1]).toBe("line 1");
    expect(lines[21]).toBe("[... 560 lines omitted ...]");
    expect(lines.at(-2)).toBe("line 600");
    expect(parseShellResult(result).exitCode).toBe(0);
    expect(result.length).toBeLessThan(INLINE_OUTPUT_LIMIT);
    const stored = await runtime.fs.readText(
      await shellOutputPath(runtime, "/w", undefined, "local-1")
    );
    expect(stored.startsWith(`${BIG}\n[exit 0 in `)).toBe(true);
  });

  it("answers a query with verified verbatim lines only", async () => {
    const { shell4, prompts } = await setup({
      reply: "L3: line 3\nL5: invented\nL999: nope\nprose",
    });
    const result = String(await shell4.invoke({ command: "find .", query: "which is line 3?" }));
    const lines = result.split("\n");
    expect(lines[1]).toBe("L3: line 3");
    expect(lines).toHaveLength(3);
    expect(parseShellResult(result).exitCode).toBe(0);
    expect(prompts[0]).toContain("## Query\nwhich is line 3?");
    expect(prompts[0]).toContain("## Output\nL1: line 1\n");
  });

  it("reads stored output by lines, query and filter", async () => {
    const { shell, shell4, read } = await setup({ reply: "L7: line 7", filtered: "line 2\n" });
    await shell4.invoke({ command: "find ." });
    expect(await read.invoke({ call_id: "local-1", lines: "2-3" })).toBe("L2: line 2\nL3: line 3");
    expect(await read.invoke({ call_id: "local-1", query: "seven?" })).toBe("L7: line 7");
    const filtered = String(await read.invoke({ call_id: "local-1", filter: "grep 'line 2$'" }));
    expect(filtered).toMatch(/^line 2\n\[exit 0 in \d+ms\]$/);
    const sandboxed = shell.spawned.at(-1)!;
    expect(sandboxed.program).toBe("sandbox-exec");
    expect(sandboxed.args.at(-1)).toMatch(
      /^grep 'line 2\$' < '\/private\/tmp\/at-sandbox\/[0-9a-f]{8}\/shell-output\/default\/local-1\.txt'$/
    );
  });

  it("rejects ambiguous and unknown reads", async () => {
    const { read } = await setup();
    expect(await read.invoke({ call_id: "nope" })).toBe("Error: no stored output for nope");
    expect(await read.invoke({ call_id: "nope", lines: "1", query: "x" })).toBe(
      "Error: give at most one of query, filter or lines"
    );
  });
});
