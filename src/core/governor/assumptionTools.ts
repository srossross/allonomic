import { tool, type StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { AskUser } from "../graph/types";
import type { AssumptionQuestion, PromptAnswer } from "../../types/tools";
import { assumptionSchema, type GovernorState } from "./types";
import type { GovernorDispatch } from "./tools";

export type ExitDecision =
  | { kind: "approve" }
  | { kind: "unmet_intent"; why: string; intentId: string }
  | { kind: "unresolved_assumptions"; why: string };

const recordSchema = z.object({
  intent_id: z.string().describe("Id of the intent the assumption belongs to."),
  text: z.string().describe("The assumption as a plain statement that reads after 'We assumed:'."),
  evidence: z
    .string()
    .optional()
    .describe("The exact quote given for a [resolved] item. Omit for [open] items."),
  depends_on: z
    .string()
    .optional()
    .describe(
      "Exact `text` of an assumption recorded earlier that this one only describes or only matters for (e.g. a fact about the target chosen there)."
    ),
});

const classifySchema = z.object({
  id: z.string().describe("Id of the open assumption."),
  resolver: z
    .enum(["user", "tool"])
    .describe(
      "'tool' (default): the agent could check it, fetch it, or do the more complete version with its tools. 'user': only when the answer exists only in the user's head and doing both is impossible, costly or destructive."
    ),
  impact_category: z
    .enum(["response_text", "wrong_answer", "incomplete_answer", "wrong_change", "wasted_work"])
    .describe(
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
  candidates: z
    .enum(["one", "countable", "open"])
    .describe(
      "'one' obvious answer in context; 'countable' if the plausible answers can be listed; 'open' if unbounded. A stale or closed candidate counts as 'countable'."
    ),
  impact_cost: z
    .enum(["low", "high"])
    .describe(
      "How bad it is if the assumption is wrong. 'low': easy to correct, read-only, nothing lost. 'high': wrong target, a lot of work wasted, or something irreversible or destructive."
    ),
});

const askSchema = z.object({
  assumption_id: z.string(),
  topic: z.string().describe("One word naming what the assumption is about, e.g. 'PR' or 'Scope'."),
  options: z
    .array(z.string())
    .optional()
    .describe("For 'countable' assumptions: the alternatives the user can pick instead."),
});

const resolutionSchema = z.object({
  id: z.string(),
  evidence: z.string().describe("Exact quote from a user message or tool output."),
});

export function createRecordTools(
  dispatch: GovernorDispatch,
  getState: () => GovernorState,
  signalFinish: () => void
): StructuredTool[] {
  let refusedCount = 0;
  const recordAssumption = tool(
    async ({ intent_id, text, evidence, depends_on }) => {
      const parent = depends_on
        ? getState().assumptions.find((a) => a.text === depends_on)
        : undefined;
      if (depends_on && !parent) {
        refusedCount += 1;
        return {
          status: "refused",
          message: `depends_on '${depends_on}' does not match the text of a recorded assumption. Record the parent earlier and copy its text exactly.`,
        };
      }
      const result = dispatch({
        type: "record_assumption",
        assumption: assumptionSchema.parse({
          id: `asm_${nanoid()}`,
          intent_id,
          text,
          status: evidence ? "resolved" : "open",
          evidence: evidence ?? null,
          depends_on: parent?.id ?? null,
        }),
      });
      if (result.status !== "recorded") refusedCount += 1;
      return result;
    },
    {
      name: "record_assumption",
      description: "Record one assumption from the list.",
      schema: recordSchema,
    }
  );
  const finishRecord = tool(
    async () => {
      if (refusedCount > 0) {
        const count = refusedCount;
        refusedCount = 0;
        return {
          status: "refused",
          message: `${count} record_assumption call${count === 1 ? " was" : "s were"} refused. Fix and re-send them, then call finish_record().`,
        };
      }
      signalFinish();
      return { status: "finished" };
    },
    {
      name: "finish_record",
      description: "Call once every item in the list has been recorded.",
      schema: z.object({}),
    }
  );
  return [recordAssumption, finishRecord];
}

export function createClassifyTools(dispatch: GovernorDispatch): StructuredTool[] {
  const addToAssumption = tool(
    async ({ id, user_would_care, request, ...fields }) => {
      if (fields.impact_category === "response_text") {
        dispatch({ type: "drop_assumption", id });
        return {
          status: "dropped",
          message: "Assumptions about the reply's wording are not kept.",
        };
      }
      if (!request && fields.resolver === "tool") {
        return {
          status: "refused",
          message:
            "A 'tool' assumption needs a request telling the agent what to do. If there is nothing the agent can do, it is not 'tool'.",
        };
      }
      return dispatch({
        type: "classify_assumption",
        id,
        classification: {
          ...fields,
          user_would_care: fields.resolver === "user" ? (user_would_care ?? null) : null,
          request: fields.resolver === "tool" ? (request ?? null) : null,
        },
      });
    },
    {
      name: "add_to_assumption",
      description: "Classify one open assumption listed under Open Assumptions.",
      schema: classifySchema,
    }
  );
  return [addToAssumption];
}

export function createAskTools(
  dispatch: GovernorDispatch,
  getState: () => GovernorState,
  toAsk: ReadonlySet<string>,
  askUser: AskUser,
  answers: Map<string, PromptAnswer>
): StructuredTool[] {
  const askUserTool = tool(
    async ({ questions }) => {
      const results: Record<string, unknown> = {};
      const asked: AssumptionQuestion[] = [];
      for (const { assumption_id: id, topic, options } of questions) {
        if (!toAsk.has(id)) {
          results[id] = { status: "refused", message: `Assumption '${id}' is not to be asked.` };
          continue;
        }
        if (answers.has(id) || asked.some((q) => q.id === id)) {
          results[id] = { status: "refused", message: `Assumption '${id}' was already asked.` };
          continue;
        }
        const assumption = getState().assumptions.find((a) => a.id === id);
        if (!assumption) {
          results[id] = { status: "not_found" };
          continue;
        }
        asked.push({ id, topic, label: `We assumed: ${assumption.text}`, options: options ?? [] });
      }
      if (asked.length === 0) return results;

      const value = await askUser({
        kind: "assumptions",
        label: `Confirm ${asked.length} assumption${asked.length === 1 ? "" : "s"}`,
        questions: asked,
      });
      for (const { id } of asked) {
        const answer = typeof value === "object" ? value[id] : value;
        if (answer === undefined) throw new Error(`No answer for assumption '${id}'`);
        answers.set(id, answer);
        results[id] =
          answer === true
            ? dispatch({ type: "resolve_assumption", id, evidence: "user confirmed" })
            : { status: "changed", answer };
      }
      return results;
    },
    {
      name: "ask_user",
      description:
        "Ask the user to confirm or change assumptions, all in one call. The user sees 'We assumed: <text>' for each, with confirm and change.",
      schema: z.object({ questions: z.array(askSchema) }),
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
    tool(
      async ({ intent_id, why }) => {
        signal({ kind: "unmet_intent", why, intentId: intent_id });
        return { status: "finished" };
      },
      {
        name: "returnToWorkerWithUnmetIntent",
        description: "No intent was satisfied. Send the work back to the agent.",
        schema: z.object({
          intent_id: z.string().describe("Id of the active intent the work did not satisfy."),
          why: z.string(),
        }),
      }
    ),
  ];
}
