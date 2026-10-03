import { tool, StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { nanoid } from "nanoid";
import { intentKindSchema, specificitySchema, type GovernorAction } from "./types";

export type GovernorDispatch = (action: GovernorAction) => Record<string, unknown>;

export function createGovernorPromptTools(
  dispatch: GovernorDispatch,
  signalFinish: (reasoning?: string) => void
): StructuredTool[] {
  const pushIntent = tool(
    async ({ id, kind, description, completed_when, overstep, specificity }) =>
      dispatch({
        type: "push_intent",
        intent: {
          id: id || `itnt_${nanoid()}`,
          kind,
          description,
          completed_when,
          overstep,
          specificity,
          changelog: [],
        },
      }),
    {
      name: "push_intent",
      description: "Push a new user goal onto the intent stack.",
      schema: z.object({
        id: z.string().optional().describe("Optional unique intent ID (e.g. 'itnt_...')."),
        kind: intentKindSchema.describe(
          "Type of user intent: 'question' (any question, including rhetorical or critical, e.g. 'can you list...?', 'why did you stop?'), 'request' (direct imperative action e.g. 'list the files'), 'feedback' (critique with no question), 'confirmation', 'other', 'unknown'."
        ),
        description: z
          .string()
          .describe(
            "User goal from the human perspective (e.g. 'User wants to know if you are capable of listing the directory')."
          ),
        completed_when: z
          .string()
          .describe(
            "One short line: the observable condition that means this intent is satisfied (e.g. 'The user has been told whether you can list the directory')."
          ),
        overstep: z
          .string()
          .describe(
            "One short line: the concrete action that would go beyond what the user asked."
          ),
        specificity: specificitySchema.describe(
          "How detailed the user's request is: 'low' leaves choices to the agent, 'high' spells out what is wanted."
        ),
      }),
    }
  );

  const updateIntent = tool(
    async ({ id, description, kind, completed_when, overstep, specificity, what_changed }) =>
      dispatch({
        type: "update_intent",
        id,
        description,
        kind,
        completed_when,
        overstep,
        specificity,
        what_changed,
      }),
    {
      name: "update_intent",
      description:
        "Update an existing intent in place when the user corrects or refines the same goal. Keeps its ID.",
      schema: z.object({
        id: z.string().describe("ID of the intent on the active stack to update."),
        description: z
          .string()
          .optional()
          .describe("Revised user goal from the human perspective."),
        kind: intentKindSchema.optional().describe("Revised intent kind, if it changed."),
        completed_when: z
          .string()
          .optional()
          .describe("One short line: revised condition that means this intent is satisfied."),
        overstep: z
          .string()
          .optional()
          .describe(
            "One short line: the revised concrete action that would go beyond what the user asked, if it changed."
          ),
        specificity: specificitySchema
          .optional()
          .describe("Revised request specificity, if it changed."),
        what_changed: z
          .string()
          .describe("One short line: what the user changed about this goal and why."),
      }),
    }
  );

  const popIntent = tool(async ({ id }) => dispatch({ type: "pop_intent", id }), {
    name: "pop_intent",
    description: "Remove an intent from the stack (by ID or the top intent).",
    schema: z.object({
      id: z
        .string()
        .optional()
        .describe("Optional ID of the intent to pop. If omitted, pops top intent."),
    }),
  });

  const finish = tool(
    async ({ reasoning }) => {
      signalFinish(reasoning);
      return {
        status: "finished",
        message: "State successfully finalized. Control passing to agent.",
        reasoning,
      };
    },
    {
      name: "finish",
      description: "Call ONLY when the intent stack accurately reflects the user's intent.",
      schema: z.object({
        reasoning: z.string().optional().describe("Brief note on why the state is now aligned."),
      }),
    }
  );

  return [pushIntent, updateIntent, popIntent, finish];
}

export type PreToolDecision = { approved: true } | { approved: false; reason: string };
