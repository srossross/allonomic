import { describe, expect, test } from "bun:test";
import { exploreSummary, groupExploreRuns } from "../src/components/chat/exploreGroups";
import type { Message, ToolCallInfo } from "../src/types";

function step(id: string, toolCalls: ToolCallInfo[], extra: Partial<Message> = {}): Message {
  return { id, role: "assistant", content: "", toolCalls, ...extra };
}

const read = (filePath: string): ToolCallInfo => ({
  name: "read_file",
  args: { filePath },
  status: "executed",
});
const ro = (command: string): ToolCallInfo => ({
  name: "shell_2_read_only",
  args: { command },
  status: "executed",
});
const list = (directory: string): ToolCallInfo => ({
  name: "list_files",
  args: { directory },
  status: "executed",
});
const write = (filePath: string): ToolCallInfo => ({
  name: "write_file",
  args: { filePath },
  status: "executed",
});

describe("groupExploreRuns", () => {
  test("merges consecutive single-call steps into one group on the first message", () => {
    const rows = groupExploreRuns([
      step("a", [read("x.py")]),
      step("b", [ro("grep foo")]),
      step("c", [list("src")]),
      step("d", [read("x.py")]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].toolItems).toHaveLength(1);
    const item = rows[0].toolItems[0];
    expect(item.kind).toBe("explore");
    if (item.kind !== "explore") return;
    expect(item.entries.map((e) => e.toolId)).toEqual(["a-tc-0", "b-tc-0", "c-tc-0", "d-tc-0"]);
    expect(exploreSummary(item.entries)).toBe("1 file, 1 dir, 1 read only command");
  });

  test("breaks on other tools, content, thinking and user messages", () => {
    const rows = groupExploreRuns([
      step("a", [read("x")]),
      step("b", [write("x")]),
      step("c", [read("y")]),
      step("d", [read("z")], { content: "done" }),
      step("e", [read("w")]),
      step("f", [read("v")], { thinking: "hmm" }),
      { id: "u", role: "user", content: "hi" },
      step("g", [read("t")]),
    ]);
    expect(rows.map((r) => r.message.id)).toEqual(["a", "b", "c", "d", "e", "f", "u", "g"]);
    const c = rows[2].toolItems[0];
    expect(c.kind === "explore" ? c.entries.map((e) => e.toolId) : []).toEqual([
      "c-tc-0",
      "d-tc-0",
    ]);
    expect(rows[3].toolItems).toEqual([]);
  });

  test("keeps the rest of a message after merging its leading explore calls", () => {
    const rows = groupExploreRuns([step("a", [read("x")]), step("b", [read("y"), write("y")])]);
    expect(rows.map((r) => r.message.id)).toEqual(["a", "b"]);
    expect(rows[1].toolItems.map((i) => i.kind)).toEqual(["tool"]);
  });

  test("excludes calls awaiting a user prompt and mutating commands", () => {
    const pending: ToolCallInfo = {
      name: "shell_1_project_read_only",
      args: { command: "ls" },
      status: "pending",
      prompt: { kind: "confirm", label: "Run?" },
    };
    const rows = groupExploreRuns([
      step("a", [read("x"), pending, { name: "shell_3_project_write", args: { command: "rm" } }]),
    ]);
    expect(rows[0].toolItems.map((i) => i.kind)).toEqual(["explore", "tool", "tool"]);
  });

  test("pluralizes counts", () => {
    const rows = groupExploreRuns([step("a", [read("x"), read("y"), ro("a"), ro("b")])]);
    const item = rows[0].toolItems[0];
    expect(item.kind === "explore" && exploreSummary(item.entries)).toBe(
      "2 files, 2 read only commands"
    );
  });
});
