import type { BaseMessage } from "@langchain/core/messages";

export interface PartLike {
  type?: string;
  thought?: boolean;
  text?: string;
  thinking?: string;
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
      (c: unknown): c is PartLike =>
        isPartLike(c) && (Boolean(c.thought) || c.type === "thought" || c.type === "thinking")
    );
    if (parts.length > 0) {
      return parts.map((p) => p.thinking || p.text || "").join("\n");
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

  const lastMessage = messages.at(-1);
  if (lastMessage && lastMessage.content) {
    const type = lastMessage._getType();
    if (type === "ai") {
      response =
        typeof lastMessage.content === "string"
          ? lastMessage.content
          : Array.isArray(lastMessage.content)
            ? lastMessage.content
                .filter(
                  (c: unknown): c is PartLike =>
                    isPartLike(c) && c.type !== "thought" && c.type !== "thinking"
                )
                .map((c: PartLike) => c.text || "")
                .join("\n")
            : JSON.stringify(lastMessage.content);
    } else if (type === "tool" && typeof lastMessage.content === "string" && lastMessage.content.startsWith("[PENDING_APPROVAL]")) {
      response = lastMessage.content;
    }
  }

  // Only extract thinking from the current turn (messages after the last user/human prompt)
  let turnStartIndex = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const type = messages[index]._getType();
    if (type === "human") {
      turnStartIndex = index;
      break;
    }
  }

  const turnMessages = messages.slice(turnStartIndex);
  for (const message of turnMessages) {
    if (message._getType() !== "ai") continue;
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
