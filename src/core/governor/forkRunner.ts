import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { StructuredTool } from "@langchain/core/tools";
import type { Runtime } from "../ports";
import type { InterceptorHook, PipelineContext } from "../graph/types";
import type { UserIntent } from "./types";
import { loopFork, type GovernorModel } from "./fork";
import { toForkMessages } from "./forkLog";
import { buildInterceptorInstructions, loadPromptFile, type PromptSection } from "./prompts";
import { loadRuleFiles, ruleSections, toContextFiles } from "../contextFiles";
import { thinkingConfigFor } from "../graph/thinking";
import type { ContextFileHook } from "../turn/events";

type ForkPhase = "entry" | "exit";

const RULES_FILE = "agents/intent.md";

const PHASE_HOOK: Record<ForkPhase, ContextFileHook> = {
  entry: "userPrompt",
  exit: "finish",
};

const PHASE_INTERCEPTOR_HOOK: Record<ForkPhase, InterceptorHook> = {
  entry: "onUserPrompt",
  exit: "onAgentFinish",
};

export interface ForkRunnerOptions {
  runtime: Runtime;
  name: string;
  modelName: string;
  apiKey?: string;
  createModel?: (tools: StructuredTool[]) => GovernorModel;
  getIntents: () => UserIntent[];
  getSections: (request: { hideFalseCompletions?: boolean }) => PromptSection[];
}

export interface ForkRequest<T> {
  context: PipelineContext;
  conversation: BaseMessage[];
  promptFile: string;
  tools: StructuredTool[];
  decision: () => T | null;
  nudge?: string;
  unknownTool?: (name: string) => string;
  phase: ForkPhase;
  appendix?: string;
  hideFalseCompletions?: boolean;
}

export class GovernorForkRunner {
  public modelName: string;
  public thinkingBudget?: number;

  constructor(private readonly options: ForkRunnerOptions) {
    this.modelName = options.modelName;
  }

  private createModel(tools: StructuredTool[]): GovernorModel {
    if (this.options.createModel) return this.options.createModel(tools);
    if (!this.options.apiKey) throw new Error("Missing Gemini API key for Governor");
    return new ChatGoogleGenerativeAI({
      model: this.modelName,
      apiKey: this.options.apiKey,
      temperature: 0,
      thinkingConfig: thinkingConfigFor(this.thinkingBudget) ?? { includeThoughts: true },
    }).bindTools(tools);
  }

  async run<T>(request: ForkRequest<T>): Promise<{ decided: T; scratchpad: BaseMessage[] }> {
    const {
      context,
      conversation,
      promptFile,
      tools,
      decision,
      nudge,
      unknownTool,
      phase,
      appendix,
      hideFalseCompletions,
    } = request;
    const { runtime, name, getIntents, getSections } = this.options;
    const [preamble, template, rules] = await Promise.all([
      loadPromptFile(runtime, "preamble.md"),
      loadPromptFile(runtime, promptFile),
      loadRuleFiles(runtime, context.workspaceDir, RULES_FILE),
    ]);
    context.events.emit({
      type: "context_files_loaded",
      agent: "governor",
      hook: PHASE_HOOK[phase],
      files: toContextFiles([preamble, template, ...rules]),
    });
    const scratchpad: BaseMessage[] = [
      ...conversation,
      new HumanMessage(
        buildInterceptorInstructions(
          preamble.text,
          [template.text, ...ruleSections(rules)].join("\n\n"),
          getIntents(),
          getSections({ hideFalseCompletions })
        ) + (appendix ? `\n${appendix}` : "")
      ),
    ];
    try {
      return await loopFork({
        scratchpad,
        label: `${name} · ${promptFile}`,
        model: this.createModel(tools),
        tools,
        decision,
        nudge,
        unknownTool,
        sessionId: context.sessionId,
        waiting: { events: context.events, source: name, hook: PHASE_INTERCEPTOR_HOOK[phase] },
      });
    } finally {
      context.events.emit({
        type: "governor_fork",
        interceptor: name,
        phase,
        pass: promptFile,
        messages: toForkMessages(scratchpad.slice(conversation.length)),
      });
    }
  }
}
