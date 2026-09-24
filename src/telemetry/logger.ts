import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { BaseMessage } from "@langchain/core/messages";

export interface LogEntry {
  pid: number;
  timestamp: string;
  turns: Array<{
    type: string;
    content: unknown;
    tool_calls?: unknown;
    tool_call_id?: string;
    name?: string;
  }>;
}

export async function logConversation(
  messages: BaseMessage[],
  workspaceDir: string = process.cwd()
): Promise<string> {
  const atomicDir = path.resolve(workspaceDir, ".atomic");
  await fs.mkdir(atomicDir, { recursive: true });

  const logFilePath = path.join(atomicDir, `conversation-${process.pid}.yml`);

  const turns = messages.map((m) => {
    const entry: {
      type: string;
      content: unknown;
      tool_calls?: unknown;
      tool_call_id?: string;
      name?: string;
    } = {
      type: m._getType(),
      content: m.content,
    };

    if ("tool_calls" in m && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      entry.tool_calls = m.tool_calls;
    }
    if ("tool_call_id" in m && typeof m.tool_call_id === "string") {
      entry.tool_call_id = m.tool_call_id;
    }
    if ("name" in m && typeof m.name === "string" && m.name) {
      entry.name = m.name;
    }
    return entry;
  });

  const data: LogEntry = {
    pid: process.pid,
    timestamp: new Date().toISOString(),
    turns,
  };

  const yamlContent = YAML.stringify(data);
  await fs.writeFile(logFilePath, yamlContent, "utf8");
  return logFilePath;
}
