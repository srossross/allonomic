import YAML from "yaml";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  HumanMessage,
  isAIMessage,
  isToolMessage,
  type AIMessage,
  type BaseMessage,
  type ToolMessage,
} from "@langchain/core/messages";
import type { StructuredTool } from "@langchain/core/tools";
import type { Runtime } from "../ports";
import { findApiKey } from "../../common/env";
import type {
  AgentInterceptor,
  InterceptorHook,
  PipelineContext,
  ToolApproval,
  ToolCall,
} from "../graph/types";
import { messageText, thinkingConfigFor } from "../graph/thinking";
import { toolContent } from "../graph/interceptorHooks";
import { loopFork, type GovernorModel } from "../governor/fork";
import { toForkMessages } from "../governor/forkLog";
import { loadPromptFile } from "../governor/prompts";
import { loadRuleFiles, ruleSections, toContextFiles } from "../contextFiles";
import type { PreToolDecision } from "../governor/tools";
import { resolveSettings } from "../config/settings";
import { parseShellResult } from "../tools/shellResult";
import {
  createTeacherPostToolTools,
  createTeacherPreToolTools,
  type PostToolDecision,
} from "./tools";

const PROMPT_DIR = "teacher";
const RULES_FILE = "agents/tools.md";

type TeacherPhase = "pre_tool" | "post_tool";

const PHASE_HOOK: Record<TeacherPhase, InterceptorHook> = {
  pre_tool: "onPreToolCall",
  post_tool: "onPostToolCall",
};

export interface ToolTeacherOptions {
  runtime: Runtime;
  createModel?: (tools: StructuredTool[]) => GovernorModel;
  modelName?: string;
  apiKey?: string;
}

interface ForkRequest<T> {
  context: PipelineContext;
  conversation: BaseMessage[];
  phase: TeacherPhase;
  tools: StructuredTool[];
  decision: () => T | null;
  nudge: string;
  appendix: string;
}

function describeCall(call: ToolCall): string {
  return `${call.id ?? "(no id)"} ${call.name}(${JSON.stringify(call.args)})`;
}

function splitProposal(conversation: BaseMessage[]): {
  history: BaseMessage[];
  proposal?: AIMessage;
} {
  let index = conversation.length - 1;
  while (index >= 0 && isToolMessage(conversation[index])) index--;
  const candidate = conversation[index];
  return !candidate || !isAIMessage(candidate) || !candidate.tool_calls?.length
    ? { history: conversation }
    : { history: conversation.slice(0, index), proposal: candidate };
}

function proposalSection(call: ToolCall, proposal?: AIMessage): string {
  const reasoning = proposal ? messageText(proposal.content).trim() : "";
  return [
    reasoning && `Worker's message alongside the call:\n${reasoning}`,
    `Call: ${describeCall(call)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export class ToolTeacherInterceptor implements AgentInterceptor {
  private runtime: Runtime;
  private apiKey?: string;
  private isEnabled = true;
  private createModelOverride?: (tools: StructuredTool[]) => GovernorModel;
  name = "ToolTeacher";
  description =
    "Teaches the worker how to use allonomic's tools, sandbox and permissions, following agents/tools.md.";
  hookDescriptions = {
    onPreToolCall: "Blocks calls that break the tool rules and explains the correct call",
    onPostToolCall: "On a non-zero exit, explains the cause and the fix",
  };
  public modelName: string;
  public thinkingBudget?: number;

  constructor(options: ToolTeacherOptions) {
    this.runtime = options.runtime;
    this.apiKey = options.apiKey || findApiKey();
    this.modelName = options.modelName ?? "gemini-3.8-flash";
    this.createModelOverride = options.createModel;
  }

  private createModel(tools: StructuredTool[]): GovernorModel {
    if (this.createModelOverride) return this.createModelOverride(tools);
    if (!this.apiKey) throw new Error("Missing Gemini API key for ToolTeacher");
    return new ChatGoogleGenerativeAI({
      model: this.modelName,
      apiKey: this.apiKey,
      temperature: 0,
      thinkingConfig: thinkingConfigFor(this.thinkingBudget) ?? { includeThoughts: true },
    }).bindTools(tools);
  }

  private async instructions(context: PipelineContext, phase: TeacherPhase): Promise<string> {
    const [manual, template, rules, settings] = await Promise.all([
      loadPromptFile(this.runtime, "teacher.md", PROMPT_DIR),
      loadPromptFile(this.runtime, `${phase}.md`, PROMPT_DIR),
      loadRuleFiles(this.runtime, context.workspaceDir, RULES_FILE),
      resolveSettings(this.runtime, context.workspaceDir, context.sessionId),
    ]);
    context.events.emit({
      type: "context_files_loaded",
      agent: "teacher",
      hook: phase === "pre_tool" ? "preTool" : "postTool",
      files: toContextFiles([manual, template, ...rules]),
    });
    const current = YAML.stringify({
      execution_mode: settings.executionMode,
      network_access: settings.networkAccess,
      sandbox: { deny: settings.sandbox.deny, ...settings.sandbox.tiers },
    });
    return [
      manual.text.trim(),
      template.text.trim(),
      ...ruleSections(rules),
      `## Current Settings\n\`\`\`yaml\n${current.trim()}\n\`\`\``,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private async fork<T>(request: ForkRequest<T>): Promise<T> {
    const { context, conversation, phase, tools, decision, nudge, appendix } = request;
    const pass = `${phase}.md`;
    const scratchpad: BaseMessage[] = [
      ...conversation,
      new HumanMessage(`${await this.instructions(context, phase)}\n\n${appendix}`),
    ];
    try {
      const { decided } = await loopFork({
        scratchpad,
        label: `${this.name} · ${pass}`,
        model: this.createModel(tools),
        tools,
        decision,
        nudge,
        waiting: { events: context.events, source: this.name, hook: PHASE_HOOK[phase] },
      });
      return decided;
    } finally {
      context.events.emit({
        type: "governor_fork",
        interceptor: this.name,
        phase,
        pass,
        messages: toForkMessages(scratchpad.slice(conversation.length)),
      });
    }
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

  async onPreToolCall(
    toolCall: ToolCall,
    conversation: BaseMessage[],
    context: PipelineContext
  ): Promise<ToolApproval> {
    if (!this.isEnabled) return { approved: true };
    let decision: PreToolDecision | null = null;
    const { history, proposal } = splitProposal(conversation);

    const decided = await this.fork({
      context,
      conversation: history,
      phase: "pre_tool",
      tools: createTeacherPreToolTools((d) => {
        decision ??= d;
      }),
      decision: () => decision,
      nudge: "You must call exactly one of allow() or deny({ reason }).",
      appendix: `## Proposed Tool Call\n${proposalSection(toolCall, proposal)}`,
    });

    const approval: ToolApproval = decided.approved
      ? { approved: true }
      : { approved: false, reason: decided.reason };
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

  async onPostToolCall(
    toolCall: ToolCall,
    result: ToolMessage,
    conversation: BaseMessage[],
    context: PipelineContext
  ): Promise<string | undefined> {
    if (!this.isEnabled) return;
    const content = toolContent(result);
    const { exitCode } = parseShellResult(content);
    if (typeof exitCode !== "number" || exitCode === 0) return;

    let decision: PostToolDecision | null = null;
    const { history, proposal } = splitProposal(conversation);
    const { lesson } = await this.fork({
      context,
      conversation: history,
      phase: "post_tool",
      tools: createTeacherPostToolTools((d) => {
        decision ??= d;
      }),
      decision: () => decision,
      nudge: "You must call exactly one of ok() or teach({ lesson }).",
      appendix: `## Failed Tool Call\n${proposalSection(toolCall, proposal)}\n\nResult:\n${content}`,
    });
    return lesson;
  }
}
