import { TOOL_SPECS } from "@/core/tools/specs";
import type { Message, ToolCallInfo } from "@/types";

export interface ToolEntry {
  tc: ToolCallInfo;
  toolId: string;
}

export type ToolItem =
  { kind: "tool"; entry: ToolEntry } | { kind: "explore"; id: string; entries: ToolEntry[] };

export interface MessageRow {
  message: Message;
  toolItems: ToolItem[];
}

export const FILE_READ_TOOLS = new Set([TOOL_SPECS.readFile.name, "view_file"]);
export const DIR_LIST_TOOLS = new Set([TOOL_SPECS.listFiles.name, "list_dir"]);
const READ_ONLY_COMMAND_TOOLS = new Set([
  TOOL_SPECS.shellProjectReadOnly.name,
  TOOL_SPECS.shellReadOnly.name,
]);

function isExploreCall(tc: ToolCallInfo) {
  return (
    !tc.prompt &&
    (FILE_READ_TOOLS.has(tc.name) ||
      DIR_LIST_TOOLS.has(tc.name) ||
      READ_ONLY_COMMAND_TOOLS.has(tc.name))
  );
}

function messageToolItems(message: Message): ToolItem[] {
  const items: ToolItem[] = [];
  const toolCalls = message.toolCalls ?? [];
  for (const [index, tc] of toolCalls.entries()) {
    const entry = { tc, toolId: `${message.id}-tc-${index}` };
    const last = items.at(-1);
    if (!isExploreCall(tc)) items.push({ kind: "tool", entry });
    else if (last?.kind === "explore") last.entries.push(entry);
    else items.push({ kind: "explore", id: `${entry.toolId}-explore`, entries: [entry] });
  }
  return items;
}

export function groupExploreRuns(messages: Message[]): MessageRow[] {
  const rows: MessageRow[] = [];
  for (const message of messages) {
    const toolItems = message.role === "assistant" ? messageToolItems(message) : [];
    const previous = rows.at(-1);
    const openRun = previous && !previous.message.content ? previous.toolItems.at(-1) : undefined;
    const leading = toolItems[0];
    if (!message.thinking && openRun?.kind === "explore" && leading?.kind === "explore") {
      openRun.entries.push(...leading.entries);
      toolItems.shift();
      if (toolItems.length === 0 && !message.content) continue;
    }
    rows.push({ message, toolItems });
  }
  return rows;
}

function plural(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

export function exploreSummary(entries: ToolEntry[]) {
  const files = new Set<string>();
  const dirs = new Set<string>();
  let commands = 0;
  for (const { tc } of entries) {
    const args = tc.args ?? {};
    if (FILE_READ_TOOLS.has(tc.name)) files.add(String(args.filePath || args.path || "file"));
    else if (DIR_LIST_TOOLS.has(tc.name)) dirs.add(String(args.directory || "."));
    else commands++;
  }
  return [
    files.size > 0 && plural(files.size, "file"),
    dirs.size > 0 && plural(dirs.size, "dir"),
    commands > 0 && plural(commands, "read only command"),
  ]
    .filter(Boolean)
    .join(", ");
}
