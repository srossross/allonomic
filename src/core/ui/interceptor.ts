import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { StructuredTool } from "@langchain/core/tools";
import type { Runtime } from "../ports";
import { findApiKey } from "../../common/env";
import type { AgentInterceptor, PipelineContext } from "../graph/types";
import { messageText, thinkingConfigFor } from "../graph/thinking";
import { loopFork, type GovernorModel } from "../governor/fork";
import { toForkMessages } from "../governor/forkLog";
import { loadPromptFile } from "../governor/prompts";
import { toContextFiles } from "../contextFiles";
import { DEFAULT_MODEL_ID } from "../../types/chat";
import { USER_SOURCE, type PresentationDraft } from "./presentation";
import { createPresentationTools, type SourceText } from "./tools";
import { isUserPrompt, lastUserPrompt } from "../graph/userPrompt";
import type { UserIntent } from "../governor/types";

const PROMPT_DIR = "ui";
const PASS = "ui.md";

export interface ResolvedIntentSource {
  resolvedSincePrompt(): UserIntent[];
}

export interface UiInterceptorOptions {
  runtime: Runtime;
  intents?: ResolvedIntentSource;
  createModel?: (tools: StructuredTool[]) => GovernorModel;
  modelName?: string;
  apiKey?: string;
}

function presenterBrief(userPrompt: string | undefined, resolved: UserIntent[]): string {
  const sections = [`## User message\n\n${userPrompt ?? "(none)"}`];
  if (resolved.length > 0)
    sections.push(
      `## Intents resolved\n\n${resolved
        .map((intent) =>
          intent.completed_when
            ? `- ${intent.description} (done when: ${intent.completed_when})`
            : `- ${intent.description}`
        )
        .join("\n")}`
    );
  return sections.join("\n\n");
}

function conversationSources(conversation: BaseMessage[]): SourceText {
  const sources = new Map<string, string>();
  for (const message of conversation)
    if (message instanceof ToolMessage)
      sources.set(message.tool_call_id, messageText(message.content));
  sources.set(
    USER_SOURCE,
    conversation
      .filter(isUserPrompt)
      .map((message) => messageText(message.content))
      .join("\n")
  );
  return (source) => sources.get(source);
}

export class UiInterceptor implements AgentInterceptor {
  private runtime: Runtime;
  private intents?: ResolvedIntentSource;
  private apiKey?: string;
  private isEnabled = true;
  private createModelOverride?: (tools: StructuredTool[]) => GovernorModel;
  name = "UI";
  description = "Presents the finished turn to the user through display tools.";
  hookDescriptions = {
    onPresent: "Renders the response, its details, questions, callouts, evidence and journey",
  };
  public modelName: string;
  public thinkingBudget?: number;

  constructor(options: UiInterceptorOptions) {
    this.runtime = options.runtime;
    this.intents = options.intents;
    this.apiKey = options.apiKey || findApiKey();
    this.modelName = options.modelName ?? DEFAULT_MODEL_ID;
    this.createModelOverride = options.createModel;
  }

  private createModel(tools: StructuredTool[]): GovernorModel {
    if (this.createModelOverride) return this.createModelOverride(tools);
    if (!this.apiKey) throw new Error("Missing Gemini API key for UI interceptor");
    return new ChatGoogleGenerativeAI({
      model: this.modelName,
      apiKey: this.apiKey,
      temperature: 0,
      thinkingConfig: thinkingConfigFor(this.thinkingBudget) ?? { includeThoughts: true },
    }).bindTools(tools);
  }

  public setModel(modelName: string, thinkingBudget?: number) {
    this.modelName = modelName;
    this.thinkingBudget = thinkingBudget;
  }

  public setIsEnabled(isEnabled: boolean) {
    this.isEnabled = isEnabled;
  }

  public getIsEnabled(): boolean {
    return this.isEnabled;
  }

  public getModelName(): string {
    return this.modelName;
  }

  async onPresent(conversation: BaseMessage[], context: PipelineContext): Promise<void> {
    if (!this.isEnabled) return;
    const prompt = await loadPromptFile(this.runtime, PASS, PROMPT_DIR);
    context.events.emit({
      type: "context_files_loaded",
      agent: "ui",
      hook: "present",
      files: toContextFiles([prompt]),
    });

    const draft: PresentationDraft = {
      responseDetails: [],
      callouts: [],
      questions: [],
      evidence: [],
    };
    let response: string | null = null;
    const tools = createPresentationTools(
      draft,
      () => {
        response = draft.response ?? null;
      },
      conversationSources(conversation)
    );
    const brief = presenterBrief(
      lastUserPrompt(conversation),
      this.intents?.resolvedSincePrompt() ?? []
    );
    const scratchpad: BaseMessage[] = [
      ...conversation,
      new HumanMessage(`${prompt.text.trim()}\n\n${brief}`),
    ];
    let decided: string;
    try {
      ({ decided } = await loopFork({
        scratchpad,
        label: `${this.name} · ${PASS}`,
        model: this.createModel(tools),
        tools,
        decision: () => response,
        nudge: "Present the turn with your tools, then call finish().",
        sessionId: context.sessionId,
        waiting: { events: context.events, source: this.name, hook: "onPresent" },
      }));
    } finally {
      context.events.emit({
        type: "governor_fork",
        interceptor: this.name,
        phase: "present",
        pass: PASS,
        messages: toForkMessages(scratchpad.slice(conversation.length + 1)),
      });
    }
    context.events.emit({
      type: "presentation",
      interceptor: this.name,
      presentation: { ...draft, response: decided },
    });
  }
}
