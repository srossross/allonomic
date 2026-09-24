import type { ContextMessage, ToolCallInfo } from "@/types";

export interface MessageLike {
  _getType?: () => string;
  role?: string;
  content?: unknown;
  name?: string;
  tool_calls?: Array<{ name: string; args: unknown; id?: string }>;
  tool_call_id?: string;
  additional_kwargs?: { thinking?: string; [key: string]: unknown };
  response_metadata?: {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string; thought?: boolean; type?: string }>;
      };
    }>;
  };
}

interface ContentTextPart {
  text?: string;
  thought?: boolean;
  type?: string;
}

function isContentPart(value: unknown): value is ContentTextPart {
  return typeof value === "object" && value !== null;
}

export function extractAssistantText(messages: MessageLike[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const isAi =
      typeof message._getType === "function"
        ? message._getType() === "ai"
        : message.role === "ai" || message.role === "assistant";
    if (isAi && message.content) {
      if (typeof message.content === "string") return message.content;
      if (Array.isArray(message.content)) {
        const text = message.content
          .filter((c: unknown) => isContentPart(c) && c.type !== "thought" && !c.thought)
          .map((c: unknown) => {
            if (isContentPart(c) && "text" in c && c.text != null) {
              return String(c.text);
            }
            return typeof c === "string" ? c : "";
          })
          .join("\n");
        if (text.trim()) return text.trim();
        continue;
      }
      return JSON.stringify(message.content);
    }
  }
  return "";
}

export function extractContextMessages(messages: MessageLike[]): ContextMessage[] {
  const contextMessages: ContextMessage[] = [
    {
      role: "system",
      content:
        "You are an expert software engineer with access to local tools. Inspect the codebase, read relevant files, and fulfill user requests directly.",
    },
  ];

  for (const m of messages) {
    let messageThinking = m.additional_kwargs?.thinking || "";
    if (!messageThinking && Array.isArray(m.content)) {
      const thoughts = m.content.filter(
        (c: unknown): c is ContentTextPart =>
          isContentPart(c) && (Boolean(c.thought) || c.type === "thought")
      );
      if (thoughts.length > 0) {
        messageThinking = thoughts.map((t) => t.text || "").join("\n");
      }
    }
    if (!messageThinking && Array.isArray(m.response_metadata?.candidates?.[0]?.content?.parts)) {
      const parts = m.response_metadata.candidates[0].content.parts;
      const thoughts = parts.filter((p) => p.thought);
      if (thoughts.length > 0) {
        messageThinking = thoughts.map((p) => p.text || "").join("\n");
      }
    }

    contextMessages.push({
      role: typeof m._getType === "function" ? m._getType() : m.role || "unknown",
      content: m.content,
      name: m.name,
      tool_calls: m.tool_calls,
      thinking: messageThinking || undefined,
    });
  }

  return contextMessages;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractTurnToolCalls(messages: MessageLike[]): ToolCallInfo[] {
  let turnStartIndex = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const m = messages[index];
    const type = typeof m._getType === "function" ? m._getType() : m.role;
    if (type === "human" || type === "user") {
      turnStartIndex = index;
      break;
    }
  }

  const turnMessages = messages.slice(turnStartIndex);
  const turnToolCalls: ToolCallInfo[] = [];

  for (const m of turnMessages) {
    const type = typeof m._getType === "function" ? m._getType() : m.role;
    if ((type === "ai" || type === "assistant") && m.tool_calls && m.tool_calls.length > 0) {
      for (const tc of m.tool_calls) {
        turnToolCalls.push({
          id: tc.id || `tc-${Date.now()}-${turnToolCalls.length}`,
          name: tc.name,
          args: isRecord(tc.args) ? tc.args : undefined,
        });
      }
    } else if (type === "tool") {
      const target = turnToolCalls.find(
        (c) => (m.tool_call_id && c.id === m.tool_call_id) || (!c.result && c.name === m.name)
      );
      if (target) {
        target.result = m.content;
        if (typeof m.content === "string" && m.content.startsWith("[PENDING_APPROVAL]")) {
          target.status = "pending";
        } else if (!target.status) {
          target.status = "executed";
        }
      }
    }
  }

  return turnToolCalls;
}
