import { z } from "zod";

export const intentKindSchema = z.enum([
  "request", // "add an image", "fix the styling", "run tests"
  "question", // "can we do X?", "how does this route work?"
  "feedback", // "it's broken on mobile", "the text is hard to read"
  "confirmation", // "looks good", "go ahead and build it"
  "other", // Catch-all
  "unknown", // Gibberish / unparseable
]);

export type IntentKind = z.infer<typeof intentKindSchema>;

const userIntentSchema = z.object({
  id: z.string(),
  kind: intentKindSchema,
  description: z.string(),
  completed_when: z.string().nullable().default(null),
  changelog: z.array(z.string()).default([]),
});

export type UserIntent = z.infer<typeof userIntentSchema>;

export const falseCompletionResolutionSchema = z.enum([
  "ruled_out",
  "clarified",
  "invalid",
  "superseded",
]);

export type FalseCompletionResolution = z.infer<typeof falseCompletionResolutionSchema>;

export const EVIDENCE_RESOLUTIONS: ReadonlySet<FalseCompletionResolution> = new Set([
  "ruled_out",
  "clarified",
]);

export const evidenceSchema = z.object({
  source: z.string(),
  quote: z.string(),
});

export type Evidence = z.infer<typeof evidenceSchema>;

const falseCompletionFields = z.object({
  id: z.string(),
  intent_id: z.string(),
  summary: z.string(),
  completes_as: z.string(),
  false_because: z.string(),
  check: z.string(),
  evidence: evidenceSchema.nullable().default(null),
  resolution: falseCompletionResolutionSchema.nullable(),
  resolution_reason: z.string().nullable(),
  still_assumed: z.string().nullable().default(null),
});

// Legacy shapes: {summary, completes_as, false_because, detect_by, directive} and {reason, needs}.
const falseCompletionSchema = z.preprocess((raw) => {
  if (typeof raw !== "object" || raw === null || "check" in raw) return raw;
  const legacy: Record<string, unknown> = { ...raw };
  return {
    ...legacy,
    summary: legacy.summary ?? legacy.reason,
    completes_as: legacy.completes_as ?? "",
    false_because: legacy.false_because ?? legacy.reason,
    check: legacy.directive ?? legacy.detect_by ?? legacy.needs ?? "",
  };
}, falseCompletionFields);

export type FalseCompletion = z.infer<typeof falseCompletionSchema>;

export interface GovernorState {
  intent_stack: UserIntent[];
  completed_intents: UserIntent[];
  false_completions: FalseCompletion[];
}

export const governorActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("push_intent"), intent: userIntentSchema }),
  z.object({
    type: z.literal("update_intent"),
    id: z.string(),
    description: z.string().optional(),
    kind: intentKindSchema.optional(),
    completed_when: z.string().optional(),
    what_changed: z.string().optional(),
  }),
  z.object({ type: z.literal("add_false_completion"), falseCompletion: falseCompletionSchema }),
  z.object({ type: z.literal("no_false_completions"), intent_id: z.string(), reason: z.string() }),
  z.object({
    type: z.literal("resolve_false_completion"),
    id: z.string(),
    resolution: falseCompletionResolutionSchema,
    evidence: evidenceSchema.optional(),
    reason: z.string().optional(),
    still_assumed: z.string().optional(),
  }),
  z.object({ type: z.literal("pop_intent"), id: z.string().optional() }),
  z.object({ type: z.literal("resolve_intent"), id: z.string() }),
]);

export type GovernorAction = z.infer<typeof governorActionSchema>;

export const verdictSchema = z.object({
  verdict: z.enum(["PASS", "FAIL"]).describe("PASS if intent is satisfied; FAIL otherwise."),
  intent_satisfied: z
    .boolean()
    .describe("Whether the top intent on the stack was satisfied by the conversation."),
  intent_assessment: z
    .string()
    .describe("Explanation of whether and how the top intent was satisfied or neglected."),
  feedback_for_agent: z
    .string()
    .describe(
      "Actionable feedback to reinject into the agent's context if FAIL, or empty string if PASS."
    ),
});

export type GovernorVerdict = z.infer<typeof verdictSchema>;
