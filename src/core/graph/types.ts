import type { BaseMessage, ToolMessage } from "@langchain/core/messages";
import type { TurnEventSink } from "../turn/events";
import type { UserPrompt, UserPromptValue } from "../../types/tools";
import type { TurnControl } from "./turnControl";

export type AskUser = (prompt: UserPrompt, toolCallId?: string) => Promise<UserPromptValue>;

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

export interface ToolApproval {
  approved: boolean;
  reason?: string;
}

export interface ExitVerdict {
  allowFinish: boolean;
  feedback?: string;
}

export interface PipelineContext {
  workspaceDir: string;
  threadId: string;
  sessionId?: string;
  turnIndex: number;
  events: TurnEventSink;
  askUser: AskUser;
  control?: TurnControl;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPipelineContext(value: unknown): value is PipelineContext {
  return (
    isRecord(value) &&
    typeof value.workspaceDir === "string" &&
    typeof value.threadId === "string" &&
    typeof value.turnIndex === "number" &&
    isRecord(value.events) &&
    typeof value.events.emit === "function" &&
    typeof value.askUser === "function"
  );
}

export function readPipelineContext(config: unknown): PipelineContext {
  const configurable = isRecord(config) ? config.configurable : undefined;
  const context = isRecord(configurable) ? configurable.context : undefined;
  if (!isPipelineContext(context))
    throw new Error("Missing PipelineContext in config.configurable.context");
  return context;
}

export function readToolCallId(config: unknown): string | undefined {
  const toolCall = isRecord(config) ? config.toolCall : undefined;
  return isRecord(toolCall) && typeof toolCall.id === "string" ? toolCall.id : undefined;
}

export const INTERCEPTOR_HOOKS = [
  "onUserPrompt",
  "onPreToolCall",
  "onPostToolCall",
  "onAgentFinish",
] as const;

export type InterceptorHook = (typeof INTERCEPTOR_HOOKS)[number];

export interface InterceptorInfo {
  name: string;
  description: string;
  modelName?: string;
  isEnabled: boolean;
  hooks: Array<{ hook: InterceptorHook; description: string }>;
}

export interface AgentInterceptor {
  name: string;
  description?: string;
  hookDescriptions?: Partial<Record<InterceptorHook, string>>;
  getModelName?(): string;
  getIsEnabled?(): boolean;

  /**
   * Called when a user submits a prompt, before the worker agent runs.
   */
  onUserPrompt?(conversation: BaseMessage[], context: PipelineContext): Promise<string | undefined>;

  /**
   * Called before any tool is executed. Can block or approve the call.
   */
  onPreToolCall?(
    toolCall: ToolCall,
    conversation: BaseMessage[],
    context: PipelineContext
  ): Promise<ToolApproval>;

  onPostToolCall?(
    toolCall: ToolCall,
    result: ToolMessage,
    conversation: BaseMessage[],
    context: PipelineContext
  ): Promise<string | undefined>;

  /**
   * Called when the worker finishes its tool loop and attempts to return.
   * If allowFinish is false, the loop will restart with the feedback injected.
   */
  onAgentFinish?(conversation: BaseMessage[], context: PipelineContext): Promise<ExitVerdict>;
}
