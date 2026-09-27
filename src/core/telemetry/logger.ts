import YAML from "yaml";
import type { BaseMessage } from "@langchain/core/messages";
import type { FileStore } from "../ports";
import { join } from "../paths";

export interface LogEntry {
  id: string;
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
  fs: FileStore,
  messages: BaseMessage[],
  workspaceDir: string = "."
): Promise<string> {
  const atomicDir = join(workspaceDir, ".allonomic");
  await fs.mkdir(atomicDir);

  const runId = crypto.randomUUID().slice(0, 8);
  const logFilePath = join(atomicDir, `conversation-${runId}.yml`);

  const turns = messages.map((m) => {
    const entry: LogEntry["turns"][number] = {
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
    id: runId,
    timestamp: new Date().toISOString(),
    turns,
  };

  await fs.writeText(logFilePath, YAML.stringify(data));
  return logFilePath;
}
