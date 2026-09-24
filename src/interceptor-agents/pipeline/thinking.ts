import type { BaseMessage } from "@langchain/core/messages";

export interface PartLike {
  type?: string;
  thought?: boolean;
  text?: string;
}

export function isPartLike(value: unknown): value is PartLike {
  return typeof value === "object" && value !== null;
}

export function extractThinking(message: BaseMessage): string {
  const kwargs = message.additional_kwargs;
  if (typeof kwargs?.thinking === "string" && kwargs.thinking) {
    return kwargs.thinking;
  }
  if (Array.isArray(message.content)) {
    const parts = message.content.filter(
      (c: unknown): c is PartLike => isPartLike(c) && (Boolean(c.thought) || c.type === "thought")
    );
    if (parts.length > 0) {
      return parts.map((p) => p.text || "").join("\n");
    }
  }
  return "";
}

export function extractFinalResponse(messages: BaseMessage[]): {
  response: string;
  thinking: string;
} {
  let response = "";
  let thinking = "";

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!(message._getType() === "ai" && message.content)) {
      continue;
    }

    response =
      typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content
              .filter((c: unknown): c is PartLike => isPartLike(c) && c.type !== "thought")
              .map((c: PartLike) => c.text || "")
              .join("\n")
          : JSON.stringify(message.content);
    if (response.trim()) break;
  }

  for (const message of messages) {
    const role = "role" in message && typeof message.role === "string" ? message.role : "";
    const isAi =
      typeof message._getType === "function"
        ? message._getType() === "ai"
        : role === "ai" || role === "assistant";
    if (!isAi) continue;

    const t = extractThinking(message);
    if (t) {
      thinking += (thinking ? "\n\n" : "") + t;
    }
  }

  return { response, thinking };
}

export function sanitizeMessagesForModel(messages: BaseMessage[]): BaseMessage[] {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) {
      return message;
    }

    const filtered = message.content.filter(
      (part: unknown) =>
        typeof part === "string" ||
        !isPartLike(part) ||
        (part.type !== "thought" && part.type !== "thinking")
    );

    const newContent =
      filtered.length === 1 && typeof filtered[0] === "string"
        ? filtered[0]
        : filtered.length === 0
          ? ""
          : filtered;

    const clone = Object.create(Object.getPrototypeOf(message));
    return Object.assign(clone, message, { content: newContent });
  });
}
