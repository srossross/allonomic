import { tool, StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { nanoid } from "nanoid";
import {
  EVIDENCE_RESOLUTIONS,
  evidenceSchema,
  falseCompletionResolutionSchema,
  type GovernorState,
} from "./types";
import type { GovernorDispatch } from "./tools";

export function createGovernorFalseCompletionTools(
  dispatch: GovernorDispatch,
  getState: () => GovernorState,
  signalFinish: (reasoning?: string) => void,
  signalRejected: (message: string) => void
): StructuredTool[] {
  const declaredFalseCompletionFree = new Set<string>();
  const evidenceField = evidenceSchema.describe(
    "source: the tool output or user message the quote comes from; quote: EXACT text from it."
  );

  const addFalseCompletion = tool(
    async ({ evidence, ...fields }) =>
      dispatch({
        type: "add_false_completion",
        falseCompletion: {
          id: `fcomp_${nanoid()}`,
          ...fields,
          evidence: evidence ?? null,
          resolution: null,
          resolution_reason: null,
          still_assumed: null,
        },
      }),
    {
      name: "add_false_completion",
      description:
        "Record a false completion: an answer the agent would hand over as done plus the one reason the user would reject it.",
      schema: z.object({
        intent_id: z.string().describe("ID of the active intent this false completion belongs to."),
        summary: z.string().describe("One short line naming the false completion."),
        completes_as: z
          .string()
          .describe("The concrete answer the agent handed over, or would hand over now, as done."),
        false_because: z
          .string()
          .describe(
            "The one specific reason the user would reject that answer. Third person ('the agent'). No 'or'."
          ),
        check: z
          .string()
          .describe(
            "One action the agent can perform that settles this false completion (e.g. 'Run git rev-parse HEAD and compare with the PR head commit')."
          ),
        evidence: evidenceField
          .optional()
          .describe("Evidence this false completion rests on. Omit if none."),
      }),
    }
  );

  const resolveFalseCompletion = tool(
    async ({ id, resolution, evidence, reason, still_assumed }) => {
      // Enforced here, not in the reducer: replayed sessions predate this field.
      if (!still_assumed && EVIDENCE_RESOLUTIONS.has(resolution)) {
        return { status: "error", message: `Resolution '${resolution}' requires still_assumed.` };
      }
      return dispatch({
        type: "resolve_false_completion",
        id,
        resolution,
        evidence,
        reason,
        still_assumed,
      });
    },
    {
      name: "resolve_false_completion",
      description: "Resolve an open false completion.",
      schema: z.object({
        id: z.string().describe("ID of the open false completion."),
        reason: z
          .string()
          .describe(
            "Your reasoning for how this false completion is settled, written before choosing."
          ),
        resolution: falseCompletionResolutionSchema.describe(
          "'ruled_out': evidence shows its completes_as can no longer be mistaken for done. 'clarified': the user answered the question it rests on. 'invalid': it was raised in error. 'superseded': a newer false completion has the same false_because, or its intent is no longer active."
        ),
        evidence: evidenceField.optional().describe("Required for ruled_out and clarified."),
        still_assumed: z
          .string()
          .optional()
          .describe(
            "Required for ruled_out and clarified. What your conclusion rests on that is not evidence. Write 'nothing' only if every claim is backed by evidence. If it is anything else, do not resolve: leave the false completion open."
          ),
      }),
    }
  );

  const noFalseCompletions = tool(
    async ({ intent_id, reason }) => {
      const result = dispatch({ type: "no_false_completions", intent_id, reason });
      if (result.status === "acknowledged") declaredFalseCompletionFree.add(intent_id);
      return result;
    },
    {
      name: "no_false_completions",
      description:
        "Declare that the conversation settles every way the user could reject the answer for an active intent. Required for every active intent without an open false completion before finish().",
      schema: z.object({
        intent_id: z.string().describe("ID of the active intent."),
        reason: z
          .string()
          .describe(
            "The ways the user could reject the answer that you considered, and the evidence that settles each one."
          ),
      }),
    }
  );

  const finish = tool(
    async ({ reasoning }) => {
      const { intent_stack, false_completions } = getState();
      const uncovered = intent_stack.filter(
        (intent) =>
          !declaredFalseCompletionFree.has(intent.id) &&
          false_completions.every(
            (falseCompletion) =>
              falseCompletion.intent_id !== intent.id || falseCompletion.resolution !== null
          )
      );
      if (uncovered.length > 0) {
        const message = `Not finished. These active intents have neither an open false completion nor a no_false_completions declaration: ${uncovered
          .map((intent) => `'${intent.id}' ("${intent.description}")`)
          .join(
            ", "
          )}. For each one, call add_false_completion for every false completion, or no_false_completions({ intent_id, reason }) if the conversation settles every way the user could reject the answer. Then call finish() again.`;
        signalRejected(message);
        return { status: "error", message };
      }
      signalFinish(reasoning);
      return { status: "finished", reasoning };
    },
    {
      name: "finish",
      description:
        "Ends this pass. Call ONLY when the false completion list accurately reflects the active intents. Fails if an active intent has neither an open false completion nor a no_false_completions declaration.",
      schema: z.object({
        reasoning: z.string().optional().describe("Brief note on the assessment."),
      }),
    }
  );

  return [addFalseCompletion, resolveFalseCompletion, noFalseCompletions, finish];
}
