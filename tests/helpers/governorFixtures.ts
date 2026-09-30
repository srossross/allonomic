import type { FalseCompletion } from "../../src/core/governor/types";

export function parse(result: unknown) {
  return typeof result === "string" ? JSON.parse(result) : result;
}

export const falseCompletion = (id: string, intent_id: string): FalseCompletion => ({
  id,
  intent_id,
  summary: `summary ${id}`,
  completes_as: "c",
  false_because: "f",
  check: "k",
  evidence: null,
  resolution: null,
  resolution_reason: null,
  still_assumed: null,
});
