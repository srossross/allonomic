import { tool, StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { nanoid } from "nanoid";
import { intentKindSchema, type GovernorAction } from "./types";

export type GovernorDispatch = (action: GovernorAction) => Record<string, unknown>;

export interface ExitVerdictSignal {
  approved: boolean;
  feedback?: string;
  nextStep?: string;
}

/**
 * Creates atomic tools for the onUserPrompt mini-agent loop.
 */
export function createGovernorPromptTools(
  dispatch: GovernorDispatch,
  signalFinish: (reasoning?: string) => void
): StructuredTool[] {
  const constraintsSchema = z
    .array(z.string())
    .optional()
    .describe("Optional initial constraints attached to this intent.");

  const pushIntent = tool(
    async ({ id, kind, description, constraints = [] }) =>
      dispatch({
        type: "push_intent",
        intent: { id: id || `itnt_${nanoid()}`, kind, description, constraints },
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
            "User goal from the human perspective (e.g. 'User wants to know if the agent is capable of listing the directory')."
          ),
        constraints: constraintsSchema,
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

  const addConstraint = tool(
    async ({ constraint, target = "global" }) =>
      dispatch({ type: "add_constraint", constraint, target }),
    {
      name: "add_constraint",
      description: "Add a boundary rule or constraint to a specific intent ID or globally.",
      schema: z.object({
        constraint: z.string().describe("The rule or constraint to enforce (e.g. 'only in blue')."),
        target: z
          .string()
          .optional()
          .describe("Intent ID to attach this constraint to, or 'global' (defaults to 'global')."),
      }),
    }
  );

  const removeConstraint = tool(
    async ({ constraint, target = "global" }) =>
      dispatch({ type: "remove_constraint", constraint, target }),
    {
      name: "remove_constraint",
      description: "Remove a constraint from a specific intent or from global constraints.",
      schema: z.object({
        constraint: z.string().describe("The constraint text to remove."),
        target: z.string().optional().describe("Intent ID or 'global'."),
      }),
    }
  );

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
      description:
        "Call ONLY when the intent stack and constraints accurately reflect the user's intent.",
      schema: z.object({
        reasoning: z.string().optional().describe("Brief note on why the state is now aligned."),
      }),
    }
  );

  return [pushIntent, popIntent, addConstraint, removeConstraint, finish];
}

/**
 * Creates tools for the onAgentFinish mini-agent loop.
 */
export function createGovernorExitTools(
  dispatch: GovernorDispatch,
  signalFinish: (result: ExitVerdictSignal) => void
): StructuredTool[] {
  const resolveIntent = tool(async ({ id }) => dispatch({ type: "resolve_intent", id }), {
    name: "resolve_intent",
    description: "Mark a specific active intent as satisfied and move it to completed history.",
    schema: z.object({
      id: z
        .string()
        .describe("ID of the intent on the active stack that was satisfied (e.g. 'itnt_...')."),
    }),
  });

  const finish = tool(
    async ({ approved, feedback = "", nextStep }) => {
      signalFinish({ approved, feedback, nextStep });
      return {
        status: "finished",
        approved,
        feedback,
        nextStep,
      };
    },
    {
      name: "finish",
      description: "Signal final verdict of exit verification.",
      schema: z.object({
        approved: z
          .boolean()
          .describe(
            "true if at least one intent was satisfied or progress was made without violating rules; false if no progress was made or rules were broken."
          ),
        feedback: z
          .string()
          .optional()
          .describe(
            "Actionable correction feedback to inject into the agent if approved is false."
          ),
        nextStep: z
          .string()
          .optional()
          .describe(
            "Optional next action to take if unfulfilled intents remain on the active stack."
          ),
      }),
    }
  );

  return [resolveIntent, finish];
}

export type PreToolDecision = { approved: true } | { approved: false; reason: string };

export function createGovernorPreToolTools(
  signalDecision: (decision: PreToolDecision) => void
): StructuredTool[] {
  const allow = tool(
    async () => {
      signalDecision({ approved: true });
      return { status: "allowed" };
    },
    {
      name: "allow",
      description: "Allow the proposed tool call to execute.",
      schema: z.object({}),
    }
  );

  const deny = tool(
    async ({ reason }) => {
      signalDecision({ approved: false, reason });
      return { status: "denied", reason };
    },
    {
      name: "deny",
      description: "Block the proposed tool call.",
      schema: z.object({
        reason: z
          .string()
          .describe("Why this tool call does not move toward satisfying the active intent."),
      }),
    }
  );

  return [allow, deny];
}
