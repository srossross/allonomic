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
    "source: file path or message the quote comes from; quote: EXACT text from the context."
  );

  const addFalseCompletion = tool(
    async ({ evidence, detect_by, ...fields }) =>
      dispatch({
        type: "add_false_completion",
        falseCompletion: {
          id: `fcomp_${nanoid()}`,
          ...fields,
          detect_by: detect_by ?? null,
          evidence: evidence ?? null,
          resolution: null,
          resolution_reason: null,
          still_assumed: null,
        },
      }),
    {
      name: "add_false_completion",
      description:
        "Record a false completion: a result you could hand over as done that the user would still reject.",
      schema: z.object({
        intent_id: z.string().describe("ID of the active intent this false completion belongs to."),
        summary: z.string().describe("One short line naming the false completion."),
        relies_on: z
          .string()
          .describe(
            "What must be true for the completion to be real. A fact you would lean on without checking: an input you were handed, an assumption in the request, a premise in a source you trust."
          ),
        completes_as: z
          .string()
          .describe(
            "The concrete result you would deliver and report as done. Must be something you could plausibly produce and believe satisfies the intent."
          ),
        false_because: z.string().describe("Why the user would still reject that result."),
        directive: z
          .string()
          .describe(
            "One short line: imperative instruction to the worker that avoids this false completion (e.g. 'Inspect the referenced source code and architecture')."
          ),
        detect_by: z
          .string()
          .optional()
          .describe(
            "What would distinguish the real completion from this one. Omit if nothing in reach would."
          ),
        evidence: evidenceField
          .optional()
          .describe("Exact quote from the context bearing on this false completion. Omit if none."),
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
      description: "Close an open false completion.",
      schema: z.object({
        id: z.string().describe("ID of the open false completion."),
        reason: z
          .string()
          .describe(
            "Your reasoning for how this false completion is settled, written before choosing."
          ),
        resolution: falseCompletionResolutionSchema.describe(
          "'ruled_out': evidence shows this result can no longer be mistaken for done. 'clarified': the user answered the ambiguity. 'invalid': it was raised in error. 'superseded': its intent is gone or changed."
        ),
        evidence: evidenceField.optional().describe("Required for ruled_out and clarified."),
        still_assumed: z
          .string()
          .optional()
          .describe(
            "Required for ruled_out and clarified. What your conclusion still rests on that was read or inferred but never seen in tool output. Record each item with add_false_completion. Write 'nothing' only if every claim is backed by tool output quoted in evidence."
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
        "Declare that an active intent has no open false completions. Required for every active intent without an open false completion before finish().",
      schema: z.object({
        intent_id: z.string().describe("ID of the active intent with no open false completions."),
        reason: z
          .string()
          .describe(
            "Your reasoning: the ways your answer could be wrong that you considered, and why the conversation already settles each one."
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
        const message = `Not finished. These active intents have no open false completions: ${uncovered
          .map((intent) => `'${intent.id}' ("${intent.description}")`)
          .join(
            ", "
          )}. For each one, call add_false_completion for every result you could deliver as done that the user would reject. Call no_false_completions({ intent_id }) only if there truly are none. Then call finish() again.`;
        signalRejected(message);
        return { status: "error", message };
      }
      signalFinish(reasoning);
      return { status: "finished", reasoning };
    },
    {
      name: "finish",
      description:
        "Call ONLY when the false completion list accurately reflects the active intents. Fails if an active intent has neither an open false completion nor a no_false_completions declaration.",
      schema: z.object({
        reasoning: z.string().optional().describe("Brief note on the assessment."),
      }),
    }
  );

  return [addFalseCompletion, resolveFalseCompletion, noFalseCompletions, finish];
}
