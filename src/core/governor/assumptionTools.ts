import { tool, type StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { AskUser } from "../graph/types";
import type { UserPromptValue } from "../../types/tools";
import { assumptionSchema, type GovernorState } from "./types";
import type { GovernorDispatch } from "./tools";

export type ExitDecision =
  | { kind: "approve" }
  | { kind: "unmet_intent"; why: string }
  | { kind: "unresolved_assumptions"; why: string };

const recordSchema = assumptionSchema.omit({ id: true, status: true, evidence: true }).extend({
  text: z
    .string()
    .describe("The assumption as a plain statement that reads after 'We assumed:'."),
  evidence: z
    .string()
    .optional()
    .describe("Exact quote from a user message or tool output that confirms it. Omit if open."),
  resolver: assumptionSchema.shape.resolver.describe(
    "'tool' (default): the agent could check it, fetch it, or do the more complete version with its tools. 'user': only when the answer exists only in the user's head and doing both is impossible, costly or destructive."
  ),
  impact_category: assumptionSchema.shape.impact_category.describe(
    "What goes wrong if the assumption is wrong. 'response_text': only the wording or format of the reply is off. 'wrong_answer': the answer is incorrect. 'incomplete_answer': the answer is missing parts. 'wrong_change': the wrong thing was modified, created or run. 'wasted_work': correct, but effort went into something not wanted."
  ),
  request: z
    .string()
    .optional()
    .describe(
      "Required for resolver 'tool'; omit otherwise. One imperative sentence telling the agent what to do to settle it, e.g. 'Fetch the line-by-line review comments on PR #4.'"
    ),
  user_would_care: z
    .boolean()
    .optional()
    .describe(
      "Only for resolver 'user'; omit otherwise. Based on the conversation and the intent's specificity: true if this user would care about this choice and want to make it themselves; false if they would leave it to the agent."
    ),
  depends_on: z
    .string()
    .optional()
    .describe(
      "Id of an assumption recorded earlier that this one only describes or only matters for (e.g. a fact about the target chosen there)."
    ),
  candidates: assumptionSchema.shape.candidates.describe(
    "'one' obvious answer in context; 'countable' if the plausible answers can be listed; 'open' if unbounded. A stale or closed candidate counts as 'countable'."
  ),
  impact_cost: assumptionSchema.shape.impact_cost.describe(
    "How bad it is if the assumption is wrong. 'low': easy to correct, read-only, nothing lost. 'high': wrong target, a lot of work wasted, or something irreversible or destructive."
  ),
});

const askSchema = z.object({
  assumption_id: z.string(),
  options: z
    .array(z.string())
    .optional()
    .describe("For 'countable' assumptions: the alternatives the user can pick instead."),
});

const resolutionSchema = z.object({
  id: z.string(),
  evidence: z.string().describe("Exact quote from a user message or tool output."),
});

export function createClassifyTools(
  dispatch: GovernorDispatch,
  signalFinish: () => void
): StructuredTool[] {
  const recordAssumption = tool(
    async ({ evidence, user_would_care, depends_on, request, ...fields }) => {
      if (fields.impact_category === "response_text") {
        return { status: "dropped", message: "Assumptions about the reply's wording are not kept." };
      }
      if (!request && fields.resolver === "tool") {
        return {
          status: "refused",
          message:
            "A 'tool' assumption needs a request telling the agent what to do. If there is nothing the agent can do, it is not 'tool'.",
        };
      }
      return dispatch({
        type: "record_assumption",
        assumption: {
          ...fields,
          user_would_care: user_would_care ?? null,
          request: fields.resolver === "tool" ? (request ?? null) : null,
          depends_on: depends_on ?? null,
          id: `asm_${nanoid()}`,
          status: evidence ? "resolved" : "open",
          evidence: evidence ?? null,
        },
      });
    },
    {
      name: "record_assumption",
      description: "Record one assumption from the list above.",
      schema: recordSchema,
    }
  );
  const finishClassify = tool(
    async () => {
      signalFinish();
      return { status: "finished" };
    },
    {
      name: "finish_classify",
      description: "Call once every assumption in the list has been recorded.",
      schema: z.object({}),
    }
  );
  return [recordAssumption, finishClassify];
}

export function createAskTools(
  dispatch: GovernorDispatch,
  getState: () => GovernorState,
  toAsk: ReadonlySet<string>,
  askUser: AskUser,
  answers: Map<string, UserPromptValue>
): StructuredTool[] {
  const askUserTool = tool(
    async ({ assumption_id, options }) => {
      if (!toAsk.has(assumption_id)) {
        return { status: "refused", message: `Assumption '${assumption_id}' is not to be asked.` };
      }
      if (answers.has(assumption_id)) {
        return { status: "refused", message: `Assumption '${assumption_id}' was already asked.` };
      }
      const assumption = getState().assumptions.find((a) => a.id === assumption_id);
      if (!assumption) return { status: "not_found" };
      const answer = await askUser({
        kind: "assumption",
        label: `We assumed: ${assumption.text}`,
        options: options ?? [],
      });
      answers.set(assumption_id, answer);
      return answer === true ? dispatch({ type: "resolve_assumption", id: assumption_id, evidence: "user confirmed" }) : { status: "changed", answer };
    },
    {
      name: "ask_user",
      description:
        "Ask the user to confirm or change one assumption. The user sees 'We assumed: <text>' with confirm and change.",
      schema: askSchema,
    }
  );
  return [askUserTool];
}

function decideTool(
  name: string,
  description: string,
  decide: (why: string) => ExitDecision,
  signal: (decision: ExitDecision) => void
): StructuredTool {
  return tool(
    async ({ why }) => {
      signal(decide(why));
      return { status: "finished" };
    },
    { name, description, schema: z.object({ why: z.string() }) }
  );
}

export function createChangedAnswerTools(signal: (decision: ExitDecision) => void) {
  return [
    decideTool(
      "returnToWorkerWithUnresolvedAssumptions",
      "The user changed at least one assumption. Send the work back to the agent.",
      (why) => ({ kind: "unresolved_assumptions", why }),
      signal
    ),
  ];
}

export function createDecideTools(
  dispatch: GovernorDispatch,
  signal: (decision: ExitDecision) => void
): StructuredTool[] {
  const resolveAssumptions = tool(
    async ({ resolutions }) =>
      resolutions.map(({ id, evidence }) => dispatch({ type: "resolve_assumption", id, evidence })),
    {
      name: "resolveAssumptions",
      description: "Resolve open assumptions that the conversation confirms.",
      schema: z.object({ resolutions: z.array(resolutionSchema) }),
    }
  );
  const resolveIntent = tool(async ({ id }) => dispatch({ type: "resolve_intent", id }), {
    name: "resolve_intent",
    description: "Mark an active intent as satisfied and move it to completed history.",
    schema: z.object({ id: z.string() }),
  });
  const atLeastOneIntentWasSatisfied = tool(
    async () => {
      signal({ kind: "approve" });
      return { status: "finished" };
    },
    {
      name: "atLeastOneIntentWasSatisfied",
      description: "At least one intent was satisfied. Ends the turn.",
      schema: z.object({}),
    }
  );
  return [
    resolveAssumptions,
    resolveIntent,
    atLeastOneIntentWasSatisfied,
    decideTool(
      "returnToWorkerWithUnmetIntent",
      "No intent was satisfied. Send the work back to the agent.",
      (why) => ({ kind: "unmet_intent", why }),
      signal
    ),
  ];
}
