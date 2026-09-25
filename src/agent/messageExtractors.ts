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
  const lastMessage = messages.at(-1);
  if (!lastMessage) return "";
  const isAi =
    typeof lastMessage._getType === "function"
      ? lastMessage._getType() === "ai"
      : lastMessage.role === "ai" || lastMessage.role === "assistant";
  if (!isAi || !lastMessage.content) return "";

  if (typeof lastMessage.content === "string") return lastMessage.content;
  if (Array.isArray(lastMessage.content)) {
    const text = lastMessage.content
      .filter((c: unknown) => isContentPart(c) && c.type !== "thought" && !c.thought)
      .map((c: unknown) => {
        if (isContentPart(c) && "text" in c && c.text != null) {
          return String(c.text);
        }
        return typeof c === "string" ? c : "";
      })
      .join("\n");
    return text.trim();
  }
  return JSON.stringify(lastMessage.content);
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

export function extractTurnSteps(messages: MessageLike[]): Array<{role: "assistant", content: string, thinking?: string, toolCalls?: ToolCallInfo[]}> {
  let turnStartIndex = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const m = messages[index];
    const type = typeof m._getType === "function" ? m._getType() : m.role;
    if (type === "human" || type === "user") {
      turnStartIndex = index;
      break;
    }
  }

  const turnMessages = messages.slice(turnStartIndex + 1);
  const steps: Array<{role: "assistant", content: string, thinking?: string, toolCalls?: ToolCallInfo[]}> = [];

  for (const m of turnMessages) {
    const type = typeof m._getType === "function" ? m._getType() : m.role;
    if (type === "ai" || type === "assistant") {
      let messageThinking = m.additional_kwargs?.thinking || "";
      if (!messageThinking && Array.isArray(m.content)) {
        const thoughts = m.content.filter(
          (c: unknown): c is ContentTextPart =>
            isContentPart(c) && (Boolean(c.thought) || c.type === "thought" || c.type === "thinking")
        );
        if (thoughts.length > 0) {
          messageThinking = thoughts.map((t) => t.text || t.thinking || "").join("\n");
        }
      }
      if (!messageThinking && Array.isArray(m.response_metadata?.candidates?.[0]?.content?.parts)) {
        const parts = m.response_metadata.candidates[0].content.parts;
        const thoughts = parts.filter((p) => p.thought);
        if (thoughts.length > 0) {
          messageThinking = thoughts.map((p) => p.text || "").join("\n");
        }
      }

      let textContent = "";
      if (typeof m.content === "string") {
        textContent = m.content;
      } else if (Array.isArray(m.content)) {
        textContent = m.content
          .filter((c: unknown) => isContentPart(c) && c.type !== "thought" && c.type !== "thinking" && !c.thought)
          .map((c: unknown) => {
            if (isContentPart(c) && "text" in c && c.text != null) {
              return String(c.text);
            }
            return typeof c === "string" ? c : "";
          })
          .join("\n").trim();
      }

      const toolCalls: ToolCallInfo[] = [];
      if (m.tool_calls && m.tool_calls.length > 0) {
        for (const tc of m.tool_calls) {
          toolCalls.push({
            id: tc.id || `tc-${Date.now()}-${toolCalls.length}`,
            name: tc.name,
            args: isRecord(tc.args) ? tc.args : undefined,
          });
        }
      }

      steps.push({
        role: "assistant",
        content: textContent,
        thinking: messageThinking || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      });
    } else if (type === "tool") {
      const applyToolResult = () => {
        for (let i = steps.length - 1; i >= 0; i--) {
          const step = steps[i];
          if (!step.toolCalls) continue;
          const target = step.toolCalls.find(
            (c) => (m.tool_call_id && c.id === m.tool_call_id) || (!c.result && c.name === m.name)
          );
          if (target) {
            target.result = m.content;
            if (typeof m.content === "string" && m.content.startsWith("[PENDING_APPROVAL]")) {
              target.status = "pending";
            } else if (!target.status) {
              target.status = "executed";
            }
            return;
          }
        }
      };
      applyToolResult();
    }
  }

  return steps;
}
