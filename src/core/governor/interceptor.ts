import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { Runtime } from "../ports";
import {
  HumanMessage,
  BaseMessage,
  ToolMessage,
  isAIMessage,
  type AIMessage,
  type AIMessageChunk,
} from "@langchain/core/messages";
import type { StructuredTool } from "@langchain/core/tools";
import { findApiKey } from "../../common/env";
import { invokeWithRetry } from "../retry";
import {
  AgentInterceptor,
  ToolCall,
  ToolApproval,
  ExitVerdict,
  PipelineContext,
} from "../graph/types";
import { GovernorState } from "./types";
import { applyGovernorAction } from "./reducer";
import {
  createGovernorPromptTools,
  createGovernorExitTools,
  createGovernorPreToolTools,
  type ExitVerdictSignal,
  type GovernorDispatch,
  type PreToolDecision,
} from "./tools";
import {
  buildDenyMessage,
  buildInterceptorInstructions,
  buildRejectionContext,
  describeToolCall,
  loadPromptFile,
} from "./prompts";

const GOVERNOR_MAX_STEPS = 50;

export interface GovernorModel {
  invoke(messages: BaseMessage[]): Promise<AIMessage | AIMessageChunk>;
}

export interface GovernorInterceptorOptions {
  runtime: Runtime;
  createModel?: (tools: StructuredTool[]) => GovernorModel;
  modelName?: string;
  apiKey?: string;
  constraintsPath?: string; // Defaults to "agents/CONSTRAINTS.md" in workspace
  initialState?: Partial<GovernorState>;
}

export class GovernorInterceptor implements AgentInterceptor {
  private runtime: Runtime;
  private constraintsPath?: string;
  private modelName: string;
  private apiKey?: string;
  private createModelOverride?: (tools: StructuredTool[]) => GovernorModel;
  name = "Governor";
  public state: GovernorState;
  public constraintsContent: string | null = null;

  constructor(options: GovernorInterceptorOptions) {
    this.runtime = options.runtime;
    this.modelName = options.modelName ?? "gemini-3.8-flash";
    this.apiKey = options.apiKey || findApiKey();
    this.constraintsPath = options.constraintsPath;
    this.createModelOverride = options.createModel;
    this.state = {
      intent_stack: options.initialState?.intent_stack ?? [],
      completed_intents: options.initialState?.completed_intents ?? [],
      global_constraints: options.initialState?.global_constraints ?? [],
    };
  }

  /**
   * Lazily loads agents/CONSTRAINTS.md from the workspace.
   */
  private async ensureConstraintsLoaded(workspaceDir: string) {
    const targetPath = await this.runtime.paths.resolve(
      workspaceDir,
      this.constraintsPath ?? "agents/CONSTRAINTS.md"
    );
    try {
      this.constraintsContent = (await this.runtime.fs.exists(targetPath))
        ? await this.runtime.fs.readText(targetPath)
        : "";
    } catch {
      this.constraintsContent = ""; // Not found or unreadable, default empty
    }
  }

  private dispatcher(context: PipelineContext, phase: "entry" | "exit"): GovernorDispatch {
    return (action) => {
      const { state, result } = applyGovernorAction(this.state, action);
      this.state = state;
      context.events.emit({ type: "governor_action", phase, interceptor: this.name, action });
      return result;
    };
  }

  private createModel(tools: StructuredTool[]): GovernorModel {
    if (this.createModelOverride) return this.createModelOverride(tools);
    return new ChatGoogleGenerativeAI({
      model: this.modelName,
      apiKey: this.apiKey,
      temperature: 0,
    }).bindTools(tools);
  }

  /**
   * Forks the worker conversation, appends the interceptor instructions as a user turn, and loops
   * until `decision()` is non-null. The fork is discarded; only tool side effects escape.
   */
  private async runFork<T>(
    conversation: BaseMessage[],
    promptFile: string,
    tools: StructuredTool[],
    decision: () => T | null,
    nudge: string
  ): Promise<T> {
    const template = await loadPromptFile(this.runtime, promptFile);
    const model = this.createModel(tools);
    const scratchpad: BaseMessage[] = [
      ...conversation,
      new HumanMessage(buildInterceptorInstructions(template, this.state, this.constraintsContent)),
    ];

    for (let step = 0; step < GOVERNOR_MAX_STEPS; step++) {
      const decided = decision();
      if (decided !== null) return decided;

      const response = await invokeWithRetry(() => model.invoke(scratchpad));
      scratchpad.push(response);

      if (!response.tool_calls || response.tool_calls.length === 0) {
        scratchpad.push(new HumanMessage(nudge));
        continue;
      }

      for (const [callIndex, call] of response.tool_calls.entries()) {
        call.id ??= `call_${Date.now()}_${callIndex}`;
        const matchingTool = tools.find((t) => t.name === call.name);
        const result = matchingTool
          ? await matchingTool.invoke(call.args)
          : `Error: unknown tool ${call.name}`;
        scratchpad.push(
          new ToolMessage({
            content: typeof result === "string" ? result : JSON.stringify(result),
            tool_call_id: call.id,
            name: call.name,
          })
        );
      }
    }

    const decided = decision();
    if (decided !== null) return decided;
    throw new Error(
      `${this.name} ${promptFile} fork made no decision within ${GOVERNOR_MAX_STEPS} steps`
    );
  }

  public setModelName(modelName: string) {
    this.modelName = modelName;
  }

  public getModelName(): string {
    return this.modelName;
  }

  async onUserPrompt(conversation: BaseMessage[], context: PipelineContext): Promise<void> {
    if (!this.apiKey) throw new Error("Missing Gemini API key for Governor");
    await this.ensureConstraintsLoaded(context.workspaceDir);

    let isFinished = false;
    const promptTools = createGovernorPromptTools(
      this.dispatcher(context, "entry"),
      (reasoning) => {
        isFinished = true;
        context.events.emit({
          type: "governor_verdict",
          phase: "entry",
          interceptor: this.name,
          approved: true,
          reasoning,
        });
      }
    );

    await this.runFork(
      conversation,
      "entry.md",
      promptTools,
      () => (isFinished ? true : null),
      "Adjust the intent stack and constraints for the latest user message, then call finish()."
    );
  }

  async onPreToolCall(
    toolCall: ToolCall,
    conversation: BaseMessage[],
    context: PipelineContext
  ): Promise<ToolApproval> {
    await this.ensureConstraintsLoaded(context.workspaceDir);

    let decision: PreToolDecision | null = null;
    const decisionTools = createGovernorPreToolTools((d) => {
      decision ??= d;
    });

    // The fork ends on the AI message holding the pending calls; Gemini requires a function response before the next user turn.
    const last = conversation.at(-1);
    const pendingResults =
      last && isAIMessage(last)
        ? (last.tool_calls ?? []).map(
            (call) =>
              new ToolMessage({
                content: "Pending Governor review.",
                tool_call_id: call.id ?? "",
                name: call.name,
              })
          )
        : [];

    const finalDecision = await this.runFork(
      [...conversation, ...pendingResults],
      "pre_tool.md",
      decisionTools,
      () => decision,
      `Review tool call ${describeToolCall(toolCall)}. You must call exactly one of allow() or deny({ reason }).`
    );

    const approval: ToolApproval = finalDecision.approved
      ? { approved: true }
      : {
          approved: false,
          reason: buildDenyMessage(this.state.intent_stack.at(-1), toolCall, finalDecision.reason),
        };

    context.events.emit({
      type: "governor_tool_decision",
      interceptor: this.name,
      tool: toolCall.name,
      toolCallId: toolCall.id,
      args: toolCall.args,
      approved: approval.approved,
      reason: approval.reason,
    });
    return approval;
  }

  async onAgentFinish(conversation: BaseMessage[], context: PipelineContext): Promise<ExitVerdict> {
    await this.ensureConstraintsLoaded(context.workspaceDir);

    if (this.state.intent_stack.length === 0 && !this.constraintsContent) {
      return { allowFinish: true };
    }

    let verdict: ExitVerdictSignal | null = null;
    const exitTools = createGovernorExitTools(this.dispatcher(context, "exit"), (v) => {
      verdict ??= v;
      context.events.emit({
        type: "governor_verdict",
        phase: "exit",
        interceptor: this.name,
        ...v,
      });
    });

    const finalVerdict = await this.runFork(
      conversation,
      "exit.md",
      exitTools,
      () => verdict,
      "Please call resolve_intent({ id }) for satisfied intents, then call finish({ approved: boolean, feedback?: string, nextStep?: string })."
    );

    if (finalVerdict.approved) {
      return { allowFinish: true, nextStep: finalVerdict.nextStep };
    }
    return {
      allowFinish: false,
      feedback:
        (finalVerdict.feedback || "Agent work was rejected.") +
        buildRejectionContext(this.state, this.constraintsContent),
    };
  }
}
