import type { BaseMessage } from "@langchain/core/messages";
import { decodeToolResult } from "../userPrompt";

export interface PartLike {
  type?: string;
  thought?: boolean;
  text?: string;
  thinking?: string;
}

export function isPartLike(value: unknown): value is PartLike {
  return typeof value === "object" && value !== null;
}

function isThoughtPart(part: unknown): part is PartLike {
  return (
    isPartLike(part) &&
    (Boolean(part.thought) || part.type === "thought" || part.type === "thinking")
  );
}

function candidateThoughts(message: BaseMessage): string {
  const metadata: unknown = message.response_metadata;
  const candidates: unknown = isPartLike(metadata)
    ? Reflect.get(metadata, "candidates")
    : undefined;
  if (!Array.isArray(candidates)) return "";
  const content: unknown = isPartLike(candidates[0])
    ? Reflect.get(candidates[0], "content")
    : undefined;
  const parts: unknown = isPartLike(content) ? Reflect.get(content, "parts") : undefined;
  return Array.isArray(parts)
    ? parts
        .filter((p: unknown): p is PartLike => isPartLike(p) && Boolean(p.thought))
        .map((p) => p.text || "")
        .join("\n")
    : "";
}

export function extractThinking(message: BaseMessage): string {
  const kwargs = message.additional_kwargs;
  if (typeof kwargs?.thinking === "string" && kwargs.thinking) {
    return kwargs.thinking;
  }
  if (Array.isArray(message.content)) {
    const parts = message.content.filter((c: unknown) => isThoughtPart(c));
    if (parts.length > 0) {
      return parts.map((p) => p.thinking || p.text || "").join("\n");
    }
  }
  return candidateThoughts(message);
}

export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content))
    return content === undefined || content === null ? "" : JSON.stringify(content);
  return content
    .filter((part: unknown) => typeof part === "string" || !isThoughtPart(part))
    .map((part: unknown) =>
      typeof part === "string" ? part : isPartLike(part) ? part.text || "" : ""
    )
    .join("\n")
    .trim();
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
      response = messageText(lastMessage.content);
    } else if (type === "tool") {
      const decoded = decodeToolResult(lastMessage.content);
      if (decoded.status === "pending") response = `Waiting for user: ${decoded.prompt.label}`;
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

export function thinkingConfigFor(
  thinkingBudget: number | undefined
): { includeThoughts?: boolean; thinkingBudget: number } | undefined {
  if (thinkingBudget === undefined) return undefined;
  return thinkingBudget > 0 ? { includeThoughts: true, thinkingBudget } : { thinkingBudget: 0 };
}
