import type { BaseMessage } from "@langchain/core/messages";
import type { PipelineContext } from "../graph/types";
import type { UserPromptValue } from "../../types/tools";
import type { GovernorForkRunner } from "./forkRunner";
import type { GovernorDispatch } from "./tools";
import type { Assumption, GovernorState } from "./types";
import { requiresToolCheck, shouldAskUser } from "./assumptionRules";
import {
  createAskTools,
  createChangedAnswerTools,
  createClassifyTools,
  createDecideTools,
  type ExitDecision,
} from "./assumptionTools";

export interface AssumptionExitRequest {
  forks: GovernorForkRunner;
  context: PipelineContext;
  conversation: BaseMessage[];
  dispatch: GovernorDispatch;
  getState: () => GovernorState;
}

export interface ExitOutcome {
  approved: boolean;
  feedback?: string;
}

const DECIDE_NUDGE =
  "Call resolveAssumptions / resolve_intent as needed, then atLeastOneIntentWasSatisfied() or returnToWorkerWithUnmetIntent({ why }).";

function decisionSignal() {
  let decided: ExitDecision | null = null;
  return {
    get: () => decided,
    set: (decision: ExitDecision) => {
      decided ??= decision;
    },
  };
}

function changedAnswersText(assumptions: Assumption[], answers: Map<string, UserPromptValue>) {
  return assumptions
    .flatMap((a) => {
      const answer = answers.get(a.id);
      return typeof answer === "string" ? [`- We assumed: ${a.text}\n  User: ${answer}`] : [];
    })
    .join("\n");
}

function verifiableFeedback(state: GovernorState, unchecked: Assumption[]): string {
  return state.intent_stack
    .flatMap((intent) => {
      const requests = unchecked
        .filter((a) => a.intent_id === intent.id)
        .map((a) => `  * ${a.request ?? a.text}`);
      return requests.length > 0
        ? [
            `For "${intent.description}", you made the following assumptions that can be verified:\n${requests.join("\n")}`,
          ]
        : [];
    })
    .join("\n\n");
}

export async function runDecide(
  request: AssumptionExitRequest,
  conversation: BaseMessage[]
): Promise<ExitDecision> {
  const signal = decisionSignal();
  const { decided } = await request.forks.run({
    context: request.context,
    conversation,
    promptFile: "assumptions_decide.md",
    tools: createDecideTools(request.dispatch, signal.set),
    decision: signal.get,
    nudge: DECIDE_NUDGE,
    phase: "exit",
  });
  return decided;
}

export async function runAssumptionExit(request: AssumptionExitRequest): Promise<ExitOutcome> {
  const { forks, context, dispatch, getState } = request;
  dispatch({ type: "clear_assumptions" });

  const listed = await forks.list({
    context,
    conversation: request.conversation,
    promptFile: "assumptions_list.md",
    phase: "exit",
  });

  let isClassified = false;
  const classified = await forks.run({
    context,
    conversation: listed.scratchpad,
    promptFile: "assumptions_classify.md",
    tools: createClassifyTools(dispatch, () => {
      isClassified = true;
    }),
    decision: () => (isClassified ? true : null),
    nudge: "Record each assumption with record_assumption, then call finish_classify().",
    phase: "exit",
  });

  const toAsk = new Set(getState().assumptions.filter(shouldAskUser).map((a) => a.id));
  const answers = new Map<string, UserPromptValue>();
  let scratchpad = classified.scratchpad;
  if (toAsk.size > 0) {
    const asked = await forks.run({
      context,
      conversation: scratchpad,
      promptFile: "assumptions_ask.md",
      appendix: `\n## Ask About\n${[...toAsk].join("\n")}`,
      tools: createAskTools(dispatch, getState, toAsk, context.askUser, answers),
      decision: () => answers.size === toAsk.size || null,
      nudge: "Call ask_user for each assumption listed under Ask About.",
      phase: "exit",
    });
    scratchpad = asked.scratchpad;
  }

  const changed = changedAnswersText(getState().assumptions, answers);
  if (changed) {
    const signal = decisionSignal();
    const { decided } = await forks.run({
      context,
      conversation: scratchpad,
      promptFile: "assumptions_decide.md",
      appendix: `\n## User Changed\n${changed}\n\nYou may only call returnToWorkerWithUnresolvedAssumptions.`,
      tools: createChangedAnswerTools(signal.set),
      decision: signal.get,
      nudge: "Call returnToWorkerWithUnresolvedAssumptions({ why }).",
      phase: "exit",
    });
    const why = decided.kind === "approve" ? "" : `${decided.why}\n\n`;
    return { approved: false, feedback: `${why}User answers:\n${changed}` };
  }

  const unchecked = getState().assumptions.filter(requiresToolCheck);
  if (unchecked.length > 0) {
    return { approved: false, feedback: verifiableFeedback(getState(), unchecked) };
  }

  const decided = await runDecide(request, scratchpad);
  return decided.kind === "approve"
    ? { approved: true }
    : { approved: false, feedback: decided.why };
}
