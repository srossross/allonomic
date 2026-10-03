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

export const specificitySchema = z.enum(["low", "med", "high"]);

const userIntentSchema = z.object({
  id: z.string(),
  kind: intentKindSchema,
  description: z.string(),
  completed_when: z.string().nullable().default(null),
  overstep: z.string().nullable().default(null),
  specificity: specificitySchema.nullable().default(null),
  changelog: z.array(z.string()).default([]),
});

export type UserIntent = z.infer<typeof userIntentSchema>;

export const assumptionSchema = z.object({
  id: z.string(),
  intent_id: z.string(),
  text: z.string(),
  status: z.enum(["open", "resolved"]),
  evidence: z.string().nullable().default(null),
  resolver: z.enum(["user", "tool"]),
  impact_category: z.enum([
    "response_text",
    "wrong_answer",
    "incomplete_answer",
    "wrong_change",
    "wasted_work",
  ]),
  user_would_care: z.boolean().nullable().default(null),
  request: z.string().nullable().default(null),
  depends_on: z.string().nullable().default(null),
  candidates: z.enum(["one", "countable", "open"]),
  impact_cost: z.enum(["low", "high"]),
});

export type Assumption = z.infer<typeof assumptionSchema>;

export interface GovernorState {
  intent_stack: UserIntent[];
  completed_intents: UserIntent[];
  assumptions: Assumption[];
  resolved_since_prompt: UserIntent[];
}

export const governorActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("push_intent"), intent: userIntentSchema }),
  z.object({
    type: z.literal("update_intent"),
    id: z.string(),
    description: z.string().optional(),
    kind: intentKindSchema.optional(),
    completed_when: z.string().optional(),
    overstep: z.string().optional(),
    specificity: specificitySchema.optional(),
    what_changed: z.string().optional(),
  }),
  z.object({ type: z.literal("record_assumption"), assumption: assumptionSchema }),
  z.object({ type: z.literal("clear_assumptions") }),
  z.object({ type: z.literal("resolve_assumption"), id: z.string(), evidence: z.string() }),
  z.object({ type: z.literal("pop_intent"), id: z.string().optional() }),
  z.object({ type: z.literal("resolve_intent"), id: z.string() }),
  z.object({ type: z.literal("begin_prompt") }),
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
