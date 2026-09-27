import type { UserPrompt } from "../types/tools";

const PENDING_VERSION = 1;
const REJECTED_PREFIX = "[USER_REJECTED]";

export type DecodedToolResult =
  { status: "pending"; prompt: UserPrompt } | { status: "rejected" } | { status: "executed" };

const EXECUTED: DecodedToolResult = { status: "executed" };

export function createPendingResult(prompt: UserPrompt): string {
  return JSON.stringify({ pending: true, v: PENDING_VERSION, prompt });
}

export function createRejectedResult(toolName: string, prompt: UserPrompt): string {
  return `${REJECTED_PREFIX} The user declined: ${prompt.label}. ${toolName} was NOT executed. Do not retry it unless the user asks; continue or ask how to proceed.`;
}

export function createResponseResult(prompt: UserPrompt, value: string): string {
  return `User response to "${prompt.label}": ${value}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isChoiceOption(value: unknown): boolean {
  return isRecord(value) && typeof value.value === "string" && typeof value.label === "string";
}

function isUserPrompt(value: unknown): value is UserPrompt {
  if (!isRecord(value) || typeof value.label !== "string") return false;
  switch (value.kind) {
    case "confirm": {
      return isOptionalString(value.detail);
    }
    case "choice": {
      return Array.isArray(value.options) && value.options.every((o) => isChoiceOption(o));
    }
    case "text": {
      return isOptionalString(value.placeholder);
    }
    default: {
      return false;
    }
  }
}

export function decodeToolResult(content: unknown): DecodedToolResult {
  if (typeof content !== "string") return EXECUTED;
  if (content.startsWith(REJECTED_PREFIX)) return { status: "rejected" };
  if (!content.startsWith("{")) return EXECUTED;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return EXECUTED;
  }
  return isRecord(parsed) && parsed.pending === true && isUserPrompt(parsed.prompt)
    ? { status: "pending", prompt: parsed.prompt }
    : EXECUTED;
}

export function isPendingToolResult(content: unknown): boolean {
  return decodeToolResult(content).status === "pending";
}
