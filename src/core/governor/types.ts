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

export const userIntentSchema = z.object({
  id: z.string(),
  kind: intentKindSchema,
  description: z.string(),
  constraints: z.array(z.string()),
});

export type UserIntent = z.infer<typeof userIntentSchema>;

export interface GovernorState {
  intent_stack: UserIntent[];
  completed_intents: UserIntent[];
  global_constraints: string[];
}

export const governorActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("push_intent"), intent: userIntentSchema }),
  z.object({ type: z.literal("pop_intent"), id: z.string().optional() }),
  z.object({ type: z.literal("add_constraint"), constraint: z.string(), target: z.string() }),
  z.object({ type: z.literal("remove_constraint"), constraint: z.string(), target: z.string() }),
  z.object({ type: z.literal("resolve_intent"), id: z.string() }),
]);

export type GovernorAction = z.infer<typeof governorActionSchema>;

export const verdictSchema = z.object({
  verdict: z
    .enum(["PASS", "FAIL"])
    .describe("PASS if intent is satisfied and no constraints violated; FAIL otherwise."),
  intent_satisfied: z
    .boolean()
    .describe("Whether the top intent on the stack was satisfied by the conversation."),
  intent_assessment: z
    .string()
    .describe("Explanation of whether and how the top intent was satisfied or neglected."),
  constraint_violations: z
    .array(z.string())
    .describe("List of constraints that were violated during execution, if any."),
  feedback_for_agent: z
    .string()
    .describe(
      "Actionable feedback to reinject into the agent's context if FAIL, or empty string if PASS."
    ),
});

export type GovernorVerdict = z.infer<typeof verdictSchema>;
