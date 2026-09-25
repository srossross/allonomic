import { tool, StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { nanoid } from "nanoid";
import { GovernorState, intentKindSchema, UserIntent } from "./types";

/**
 * Creates atomic tools for the onUserPrompt mini-agent loop.
 */
export function createGovernorPromptTools(
  state: GovernorState,
  signalFinish: () => void
): StructuredTool[] {
  const constraintsSchema = z
    .array(z.string())
    .optional()
    .describe("Optional initial constraints attached to this intent.");

  const pushIntent = tool(
    async ({ id: providedId, kind, description, constraints = [] }) => {
      const id = providedId || `itnt_${nanoid()}`;
      const newIntent: UserIntent = {
        id,
        kind,
        description,
        constraints,
      };
      state.intent_stack.push(newIntent);
      return {
        status: "created",
        intent: newIntent,
        message: `Created intent '${id}' (${kind}): "${description}"`,
      };
    },
    {
      name: "push_intent",
      description: "Push a new user goal onto the intent stack.",
      schema: z.object({
        id: z.string().optional().describe("Optional unique intent ID (e.g. 'itnt_...')."),
        kind: intentKindSchema.describe(
          "Type of user intent: 'question' (inquiring about capability or feasibility e.g. 'can you list...?'), 'request' (direct imperative action e.g. 'list the files'), 'feedback', 'confirmation', 'other', 'unknown'."
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

  const popIntent = tool(
    async ({ id }) => {
      if (id) {
        const index = state.intent_stack.findIndex((index_) => index_.id === id);
        if (index !== -1) {
          const removed = state.intent_stack.splice(index, 1)[0];
          return { status: "popped", id, description: removed.description };
        }
        return { status: "not_found", message: `Intent with id '${id}' not found.` };
      }

      if (state.intent_stack.length > 0) {
        const removed = state.intent_stack.pop()!;
        return { status: "popped", id: removed.id, description: removed.description };
      }
      return { status: "empty", message: "Intent stack is already empty." };
    },
    {
      name: "pop_intent",
      description: "Remove an intent from the stack (by ID or the top intent).",
      schema: z.object({
        id: z
          .string()
          .optional()
          .describe("Optional ID of the intent to pop. If omitted, pops top intent."),
      }),
    }
  );

  const addConstraint = tool(
    async ({ constraint, target = "global" }) => {
      if (target === "global") {
        state.global_constraints.push(constraint);
        return { status: "added", target: "global", constraint };
      }

      const intent = state.intent_stack.find((index) => index.id === target);
      if (intent) {
        intent.constraints.push(constraint);
        return { status: "added", target, constraint };
      }

      const lastIntent = state.intent_stack.at(-1);
      if (lastIntent) {
        lastIntent.constraints.push(constraint);
        return {
          status: "added",
          target: lastIntent.id,
          constraint,
        };
      }

      state.global_constraints.push(constraint);
      return { status: "added", target: "global", constraint };
    },
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
    async ({ constraint, target = "global" }) => {
      if (target === "global") {
        state.global_constraints = state.global_constraints.filter((c) => c !== constraint);
        return { status: "removed", target: "global", constraint };
      }

      const intent = state.intent_stack.find((index) => index.id === target);
      if (intent) {
        intent.constraints = intent.constraints.filter((c) => c !== constraint);
        return { status: "removed", target, constraint };
      }
      return { status: "not_found", message: `Target '${target}' not found.` };
    },
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
      signalFinish();
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
  state: GovernorState,
  signalFinish: (result: { approved: boolean; feedback?: string; nextStep?: string }) => void
): StructuredTool[] {
  const resolveIntent = tool(
    async ({ id }) => {
      const index = state.intent_stack.findIndex((index_) => index_.id === id);
      if (index !== -1) {
        const [completed] = state.intent_stack.splice(index, 1);
        state.completed_intents.push(completed);
        return {
          status: "resolved",
          id: completed.id,
          description: completed.description,
          message: `Intent '${completed.id}' marked as satisfied and moved to history.`,
        };
      }
      return {
        status: "not_found",
        message: `Intent with id '${id}' not found on the active stack.`,
      };
    },
    {
      name: "resolve_intent",
      description: "Mark a specific active intent as satisfied and move it to completed history.",
      schema: z.object({
        id: z
          .string()
          .describe("ID of the intent on the active stack that was satisfied (e.g. 'itnt_...')."),
      }),
    }
  );

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
