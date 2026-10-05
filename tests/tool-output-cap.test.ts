import { describe, it, expect } from "bun:test";
import { ToolMessage } from "@langchain/core/messages";
import { TOOL_OUTPUT_LIMIT, capToolMessage, capToolOutput } from "../src/core/tools/toolOutputCap";
import { formatShellResult, parseShellResult } from "../src/core/tools/shellResult";

const PATH = "/private/tmp/at-sandbox/abc/tool-output/s1/call_1.txt";

describe("capToolOutput", () => {
  it("keeps 25k head and tail and appends the path line", () => {
    const content = "H".repeat(30_000) + "M".repeat(40_000) + "T".repeat(30_000);
    const capped = capToolOutput(content, PATH);
    const lines = capped.split("\n");
    expect(lines[0]).toBe("H".repeat(25_000));
    expect(lines[1]).toBe("[... 50000 chars omitted ...]");
    expect(lines[2]).toBe("T".repeat(25_000));
    expect(lines.at(-1)).toBe(`[full output in ${PATH}]`);
  });

  it("folds the path into the shell footer and still parses", () => {
    const content = formatShellResult("x".repeat(100_000), "", 0, 1014);
    const capped = capToolOutput(content, PATH);
    expect(capped.endsWith(`[exit 0 in 1014ms; full output in ${PATH}]`)).toBe(true);
    expect(parseShellResult(capped)).toMatchObject({ exitCode: 0, durationMs: 1014 });
  });
});

describe("capToolMessage", () => {
  it("stores full output and caps only above the limit", async () => {
    const stored: string[] = [];
    const store = async (_id: string, content: string) => {
      stored.push(content);
      return PATH;
    };
    const small = new ToolMessage({ content: "ok", tool_call_id: "c0", name: "t" });
    expect(await capToolMessage(small, store)).toBe(small);

    const big = "y".repeat(TOOL_OUTPUT_LIMIT + 1);
    const capped = await capToolMessage(
      new ToolMessage({ content: big, tool_call_id: "c1", name: "t" }),
      store
    );
    expect(stored).toEqual([big]);
    expect(String(capped.content).endsWith(`[full output in ${PATH}]`)).toBe(true);
    expect(capped.tool_call_id).toBe("c1");
  });
});
