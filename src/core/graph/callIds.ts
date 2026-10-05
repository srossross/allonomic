import { ToolMessage, isAIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ToolCall } from "@langchain/core/messages/tool";
import { nanoid } from "nanoid";

// Provider tool_call ids are only unique within one model response, so they never key our state.
const CALL_IDS_KEY = "allonomic_call_ids";
const CALL_ID_KEY = "allonomic_call_id";

export function newCallId(): string {
  return `call_${nanoid()}`;
}

export function callIdKwargs(ids: string[]): Record<string, string[]> {
  return { [CALL_IDS_KEY]: ids };
}

export function callIdsOf(message: BaseMessage): string[] {
  const calls = isAIMessage(message) ? (message.tool_calls ?? []) : [];
  if (calls.length === 0) return [];
  const ids: unknown = message.additional_kwargs?.[CALL_IDS_KEY];
  if (
    !Array.isArray(ids) ||
    ids.length !== calls.length ||
    ids.some((id) => typeof id !== "string")
  )
    throw new Error(`AI message ${message.id ?? ""} has tool calls without call ids`);
  return ids;
}

export function ourToolCalls(message: BaseMessage): ToolCall[] {
  const ids = callIdsOf(message);
  const calls = isAIMessage(message) ? (message.tool_calls ?? []) : [];
  return calls.map((call, i) => ({ ...call, id: ids[i] }));
}

export function callIdOf(message: ToolMessage): string {
  const id: unknown = message.additional_kwargs?.[CALL_ID_KEY];
  if (typeof id !== "string") throw new Error(`Tool message ${message.id ?? ""} has no call id`);
  return id;
}

export function forModel(result: ToolMessage, providerId: string | undefined): ToolMessage {
  return new ToolMessage({
    content: result.content,
    name: result.name,
    status: result.status,
    tool_call_id: providerId ?? "",
    additional_kwargs: { [CALL_ID_KEY]: result.tool_call_id },
  });
}
