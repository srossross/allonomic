import type { BaseMessage } from "@langchain/core/messages";
import type { PipelineContext } from "../graph/types";
import type { GovernorState } from "./types";
import type { GovernorDispatch } from "./tools";
import type { FalseCompletionPasses } from "./falseCompletions";

export function verdictEmitter(
  context: PipelineContext,
  interceptor: string,
  phase: "entry" | "exit",
  isApproved: boolean
) {
  return (text?: string) =>
    context.events.emit({
      type: "governor_verdict",
      phase,
      interceptor,
      approved: isApproved,
      ...(isApproved ? { reasoning: text } : { feedback: text ?? "" }),
    });
}

export interface ReconciliationRequest {
  context: PipelineContext;
  conversation: BaseMessage[];
  dispatch: GovernorDispatch;
  phase: "entry" | "exit";
  interceptor: string;
  getState: () => GovernorState;
  hasFalseCompletions: boolean;
  falseCompletions: FalseCompletionPasses;
}

export async function runReconciliation(request: ReconciliationRequest): Promise<void> {
  const {
    context,
    conversation,
    dispatch,
    phase,
    interceptor,
    getState,
    hasFalseCompletions,
    falseCompletions,
  } = request;
  if (!hasFalseCompletions) return;

  const passRequest = {
    context,
    conversation,
    dispatch,
    getState,
    signalRejected: verdictEmitter(context, interceptor, phase, false),
  };
  await (phase === "entry"
    ? falseCompletions.enterAfterIntent(passRequest)
    : falseCompletions.exitBeforeIntent(passRequest));
}
