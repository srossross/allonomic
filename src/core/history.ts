import type { Message } from "@/types";

interface HistoryToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  thoughtSignature?: string;
}

export interface HistoryEntry {
  role: string;
  content: string;
  tool_calls?: HistoryToolCall[];
  tool_call_id?: string;
  name?: string;
}

export function buildHistory(messages: Message[]): HistoryEntry[] {
  return messages.flatMap((m) => {
    if (m.isError) return [];
    const entries: HistoryEntry[] = [{ role: m.role, content: m.content }];
    if (m.toolCalls && m.toolCalls.length > 0) {
      entries[0].tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id || "unknown",
        name: tc.name || "unknown",
        args: tc.args || {},
        thoughtSignature: tc.thoughtSignature,
      }));
      for (const tc of m.toolCalls) {
        if (tc.result === undefined) continue;
        entries.push({
          role: "tool",
          content: typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result || ""),
          tool_call_id: tc.id || "unknown",
          name: tc.name || "unknown",
        });
      }
    }
    return entries;
  });
}
