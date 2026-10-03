import type { Runtime } from "../ports";
import type { BaseMessage } from "@langchain/core/messages";
import type { StructuredTool } from "@langchain/core/tools";
import { findApiKey } from "../../common/env";
import type { GovernorModel } from "./fork";
import type { AgentInterceptor, EntryBrief, ExitVerdict, PipelineContext } from "../graph/types";
import type { GovernorState, UserIntent } from "./types";
import { DEFAULT_MODEL_ID } from "../../types/chat";
import { applyGovernorAction } from "./reducer";
import { createGovernorPromptTools, type GovernorDispatch } from "./tools";
import { GovernorForkRunner } from "./forkRunner";
import { assumptionSection, buildIntentBrief } from "./prompts";
import { runAssumptionExit, runDecide, type ExitOutcome } from "./assumptionExit";
import type { ExitDecision } from "./assumptionTools";

function toOutcome(decided: ExitDecision): ExitOutcome {
  return decided.kind === "approve"
    ? { approved: true }
    : { approved: false, feedback: decided.why };
}

export type { GovernorModel } from "./fork";

export interface GovernorInterceptorOptions {
  runtime: Runtime;
  createModel?: (tools: StructuredTool[]) => GovernorModel;
  modelName?: string;
  apiKey?: string;
  initialState?: Partial<GovernorState>;
}

export class GovernorInterceptor implements AgentInterceptor {
  private apiKey?: string;
  private hasAssumptions = true;
  private isEnabled = true;
  private forks: GovernorForkRunner;
  name = "Governor";
  description =
    "Tracks the user's intents and checks that the worker's actions and results satisfy them.";
  hookDescriptions = {
    onUserPrompt: "Updates the intent stack and briefs the worker on added or changed intents",
    onAgentFinish: "Verifies intents are satisfied; rejects and retries if not",
  };
  public state: GovernorState;

  constructor(options: GovernorInterceptorOptions) {
    this.apiKey = options.apiKey || findApiKey();
    this.state = {
      intent_stack: options.initialState?.intent_stack ?? [],
      completed_intents: options.initialState?.completed_intents ?? [],
      assumptions: options.initialState?.assumptions ?? [],
      resolved_since_prompt: options.initialState?.resolved_since_prompt ?? [],
    };
    this.forks = new GovernorForkRunner({
      runtime: options.runtime,
      name: this.name,
      modelName: options.modelName ?? DEFAULT_MODEL_ID,
      apiKey: this.apiKey,
      createModel: options.createModel,
      getIntents: () => this.state.intent_stack,
      getSections: () => [assumptionSection(this.state)],
    });
  }

  private dispatcher(context: PipelineContext, phase: "entry" | "exit"): GovernorDispatch {
    return (action) => {
      const { state, result } = applyGovernorAction(this.state, action);
      this.state = state;
      context.events.emit({ type: "governor_action", phase, interceptor: this.name, action });
      return result;
    };
  }

  public setModel(modelName: string, thinkingBudget?: number) {
    this.forks.modelName = modelName;
    this.forks.thinkingBudget = thinkingBudget;
  }

  public getModelName(): string {
    return this.forks.modelName;
  }

  public setHasAssumptions(hasAssumptions: boolean) {
    this.hasAssumptions = hasAssumptions;
  }

  public setIsEnabled(isEnabled: boolean) {
    this.isEnabled = isEnabled;
  }

  public getIsEnabled(): boolean {
    return this.isEnabled;
  }

  public resolvedSincePrompt(): UserIntent[] {
    return this.state.resolved_since_prompt;
  }

  async onUserPrompt(
    conversation: BaseMessage[],
    context: PipelineContext
  ): Promise<EntryBrief | undefined> {
    if (!this.isEnabled) return;

    const dispatch = this.dispatcher(context, "entry");
    dispatch({ type: "begin_prompt" });
    const before = this.state.intent_stack;
    let areIntentsFinished = false;
    const promptTools = createGovernorPromptTools(dispatch, (reasoning) => {
      if (areIntentsFinished) return;
      areIntentsFinished = true;
      context.events.emit({
        type: "governor_verdict",
        phase: "entry",
        interceptor: this.name,
        approved: true,
        reasoning,
      });
    });

    await this.forks.run({
      context,
      conversation,
      promptFile: "entry.md",
      tools: promptTools,
      decision: () => (areIntentsFinished ? true : null),
      nudge: "Adjust the intent stack for the latest user message, then call finish().",
      phase: "entry",
    });

    const after = this.state.intent_stack;
    const previous = (intent: UserIntent) => before.find((b) => b.id === intent.id);
    const changes = {
      added: after.filter((intent) => !previous(intent)),
      changed: after.filter((intent) => {
        const prior = previous(intent);
        return prior !== undefined && prior !== intent;
      }),
      dropped: before.filter((intent) => after.every((a) => a.id !== intent.id)),
    };
    const text = buildIntentBrief(changes);
    if (!text) return;
    return {
      text,
      doneWhen: [...changes.added, ...changes.changed].flatMap((intent) =>
        intent.completed_when ? [intent.completed_when] : []
      ),
    };
  }

  async onAgentFinish(conversation: BaseMessage[], context: PipelineContext): Promise<ExitVerdict> {
    if (!this.isEnabled || this.state.intent_stack.length === 0) {
      return { allowFinish: true };
    }

    const request = {
      forks: this.forks,
      context,
      conversation,
      dispatch: this.dispatcher(context, "exit"),
      getState: () => this.state,
    };
    const outcome = this.hasAssumptions
      ? await runAssumptionExit(request)
      : toOutcome(await runDecide(request, conversation));
    context.events.emit({ type: "governor_verdict", phase: "exit", interceptor: this.name, ...outcome });
    return { allowFinish: outcome.approved, feedback: outcome.feedback };
  }
}
