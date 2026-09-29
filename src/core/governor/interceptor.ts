import type { Runtime } from "../ports";
import { BaseMessage } from "@langchain/core/messages";
import type { StructuredTool } from "@langchain/core/tools";
import { findApiKey } from "../../common/env";
import type { GovernorModel } from "./fork";
import { AgentInterceptor, ExitVerdict, PipelineContext } from "../graph/types";
import { GovernorState, type UserIntent } from "./types";
import { applyGovernorAction } from "./reducer";
import {
  createGovernorPromptTools,
  createGovernorExitTools,
  type ExitVerdictSignal,
  type GovernorDispatch,
  type IntentBlocks,
} from "./tools";
import { GovernorForkRunner } from "./forkRunner";
import {
  FalseCompletionPasses,
  falseCompletionBlocks,
  falseCompletionSection,
} from "./falseCompletions";
import { runReconciliation, verdictEmitter } from "./reconciliation";
import { buildIntentBrief, buildRejectionContext } from "./prompts";

export type { GovernorModel } from "./fork";

const NO_BLOCKS: IntentBlocks = { resolve: () => null, approve: () => null };

export interface GovernorInterceptorOptions {
  runtime: Runtime;
  createModel?: (tools: StructuredTool[]) => GovernorModel;
  modelName?: string;
  apiKey?: string;
  initialState?: Partial<GovernorState>;
}

export class GovernorInterceptor implements AgentInterceptor {
  private apiKey?: string;
  private hasFalseCompletions = true;
  private isEnabled = true;
  private forks: GovernorForkRunner;
  private falseCompletions: FalseCompletionPasses;
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
      false_completions: options.initialState?.false_completions ?? [],
    };
    this.forks = new GovernorForkRunner({
      runtime: options.runtime,
      name: this.name,
      modelName: options.modelName ?? "gemini-3.8-flash",
      apiKey: this.apiKey,
      createModel: options.createModel,
      getIntents: () => this.state.intent_stack,
      getSections: ({ hideFalseCompletions }) => [
        falseCompletionSection(this.state, hideFalseCompletions || !this.hasFalseCompletions),
      ],
    });
    this.falseCompletions = new FalseCompletionPasses(this.forks);
  }

  private dispatcher(context: PipelineContext, phase: "entry" | "exit"): GovernorDispatch {
    return (action) => {
      const { state, result } = applyGovernorAction(this.state, action);
      this.state = state;
      context.events.emit({ type: "governor_action", phase, interceptor: this.name, action });
      return result;
    };
  }

  private reconcile(
    context: PipelineContext,
    conversation: BaseMessage[],
    dispatch: GovernorDispatch,
    phase: "entry" | "exit"
  ): Promise<void> {
    return runReconciliation({
      context,
      conversation,
      dispatch,
      phase,
      interceptor: this.name,
      getState: () => this.state,
      hasFalseCompletions: this.hasFalseCompletions,
      falseCompletions: this.falseCompletions,
    });
  }

  public setModel(modelName: string, thinkingBudget?: number) {
    this.forks.modelName = modelName;
    this.forks.thinkingBudget = thinkingBudget;
  }

  public getModelName(): string {
    return this.forks.modelName;
  }

  public setHasFalseCompletions(hasFalseCompletions: boolean) {
    this.hasFalseCompletions = hasFalseCompletions;
  }

  public setIsEnabled(isEnabled: boolean) {
    this.isEnabled = isEnabled;
  }

  public getIsEnabled(): boolean {
    return this.isEnabled;
  }

  async onUserPrompt(
    conversation: BaseMessage[],
    context: PipelineContext
  ): Promise<string | undefined> {
    if (!this.isEnabled) return;
    if (!this.apiKey) throw new Error("Missing Gemini API key for Governor");

    const before = this.state.intent_stack;
    const dispatch = this.dispatcher(context, "entry");
    const emitFinish = verdictEmitter(context, this.name, "entry", true);

    let areIntentsFinished = false;
    const promptTools = createGovernorPromptTools(dispatch, (reasoning) => {
      areIntentsFinished = true;
      emitFinish(reasoning);
    });

    const { scratchpad } = await this.forks.run({
      context,
      conversation,
      promptFile: "entry.md",
      tools: promptTools,
      decision: () => (areIntentsFinished ? true : null),
      nudge: "Adjust the intent stack for the latest user message, then call finish().",
      phase: "entry",
    });

    await this.reconcile(context, scratchpad, dispatch, "entry");

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
    const text = buildIntentBrief(changes, this.state);
    if (!text) return;
    context.events.emit({
      type: "governor_brief",
      interceptor: this.name,
      text,
      doneWhen: [...changes.added, ...changes.changed].flatMap((intent) =>
        intent.completed_when ? [intent.completed_when] : []
      ),
    });
    return text;
  }

  async onAgentFinish(conversation: BaseMessage[], context: PipelineContext): Promise<ExitVerdict> {
    if (!this.isEnabled || this.state.intent_stack.length === 0) {
      return { allowFinish: true };
    }

    const dispatch = this.dispatcher(context, "exit");
    await this.reconcile(context, conversation, dispatch, "exit");

    let verdict: ExitVerdictSignal | null = null;
    const onVerdict = (v: ExitVerdictSignal) => {
      verdict ??= v;
      context.events.emit({
        type: "governor_verdict",
        phase: "exit",
        interceptor: this.name,
        ...v,
      });
    };
    const exitTools = createGovernorExitTools(
      dispatch,
      this.hasFalseCompletions ? falseCompletionBlocks(() => this.state) : NO_BLOCKS,
      onVerdict
    );

    const { decided: finalVerdict } = await this.forks.run({
      context,
      conversation,
      promptFile: "exit.md",
      tools: exitTools,
      decision: () => verdict,
      nudge:
        "Please call resolve_intent({ id }) for satisfied intents, then call finish({ approved: boolean, feedback?: string, nextStep?: string }).",
      phase: "exit",
    });

    if (finalVerdict.approved) {
      return { allowFinish: true, nextStep: finalVerdict.nextStep };
    }
    return {
      allowFinish: false,
      feedback:
        (finalVerdict.feedback || "Agent work was rejected.") + buildRejectionContext(this.state),
    };
  }
}
