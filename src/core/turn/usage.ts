import type { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import type { ModelPrice } from "../../types/chat";
import type { TurnEventOf, TurnEventSink } from "./events";

export interface UsageRow {
  agent: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  longInputTokens: number;
  longOutputTokens: number;
}

export type TokenUsage = UsageRow[];

export interface UsageCost {
  input: number;
  output: number;
}

export const WORKER_AGENT = "worker";

const LONG_PROMPT_TOKENS = 200_000;

export function interceptorAgent(name: string): string {
  return `interceptor/${name}`;
}

export function emitModelUsage(
  events: TurnEventSink,
  agent: string,
  model: string,
  response: AIMessage | AIMessageChunk
) {
  const usage = response.usage_metadata;
  if (!usage) return;
  events.emit({
    type: "model_usage",
    agent,
    model,
    inputTokens: usage.input_tokens,
    outputTokens: Math.max(usage.output_tokens, usage.total_tokens - usage.input_tokens),
  });
}

export function addModelUsage(usage: TokenUsage, event: TurnEventOf<"model_usage">): TokenUsage {
  const agent = event.agent ?? event.actor;
  const isLong = event.inputTokens > LONG_PROMPT_TOKENS;
  const existing = usage.find((row) => row.agent === agent && row.model === event.model);
  const base = existing ?? {
    agent,
    model: event.model,
    inputTokens: 0,
    outputTokens: 0,
    longInputTokens: 0,
    longOutputTokens: 0,
  };
  const next: UsageRow = {
    ...base,
    inputTokens: base.inputTokens + event.inputTokens,
    outputTokens: base.outputTokens + event.outputTokens,
    longInputTokens: base.longInputTokens + (isLong ? event.inputTokens : 0),
    longOutputTokens: base.longOutputTokens + (isLong ? event.outputTokens : 0),
  };
  return existing ? usage.map((row) => (row === existing ? next : row)) : [...usage, next];
}

export function usageCost(row: UsageRow, price: ModelPrice): UsageCost {
  const shortInput = row.inputTokens - row.longInputTokens;
  const shortOutput = row.outputTokens - row.longOutputTokens;
  return {
    input: (shortInput * price.input + row.longInputTokens * price.longInput) / 1_000_000,
    output: (shortOutput * price.output + row.longOutputTokens * price.longOutput) / 1_000_000,
  };
}
