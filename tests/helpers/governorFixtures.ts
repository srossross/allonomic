import type { Assumption } from "../../src/core/governor/types";

export function parse(result: unknown) {
  return typeof result === "string" ? JSON.parse(result) : result;
}

export const assumption = (
  id: string,
  intent_id: string,
  overrides: Partial<Assumption> = {}
): Assumption => ({
  id,
  intent_id,
  text: `text ${id}`,
  status: "open",
  evidence: null,
  resolver: "user",
  impact_category: "wrong_answer",
  user_would_care: false,
  request: null,
  depends_on: null,
  candidates: "one",
  impact_cost: "low",
  ...overrides,
});
