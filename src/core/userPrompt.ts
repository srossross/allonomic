import type { UserPrompt } from "../types/tools";

const REJECTED_PREFIX = "[USER_REJECTED]";

export interface DecodedToolResult {
  status: "rejected" | "executed";
}

export function createRejectedResult(toolName: string, prompt: UserPrompt): string {
  return `${REJECTED_PREFIX} The user declined: ${prompt.label}. ${toolName} was NOT executed. Do not retry it unless the user asks; continue or ask how to proceed.`;
}

export function decodeToolResult(content: unknown): DecodedToolResult {
  const isRejected = typeof content === "string" && content.startsWith(REJECTED_PREFIX);
  return { status: isRejected ? "rejected" : "executed" };
}
