import { BaseMessage } from "@langchain/core/messages";

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
  nextStep?: string;
}

export interface PipelineContext {
  workspaceDir: string;
  threadId: string;
  sessionId?: string;
  turnIndex?: number;
  metadata?: Record<string, unknown>;
  entryToolCalls?: Array<{ name: string; args?: Record<string, unknown> }>;
  preToolLogs?: Array<{
    tool: string;
    args?: Record<string, unknown>;
    approved: boolean;
    reason?: string;
  }>;
  exitToolCalls?: Array<{ name: string; args?: Record<string, unknown> }>;
}

export interface AgentInterceptor {
  name: string;

  /**
   * Called when a user submits a prompt, before the worker agent runs.
   */
  onUserPrompt?(prompt: string, context: PipelineContext): Promise<void>;

  /**
   * Called before any tool is executed. Can block or approve the call.
   */
  onPreToolCall?(toolCall: ToolCall, context: PipelineContext): Promise<ToolApproval>;

  /**
   * Called when the worker finishes its tool loop and attempts to return.
   * If allowFinish is false, the loop will restart with the feedback injected.
   */
  onAgentFinish?(messages: BaseMessage[], context: PipelineContext): Promise<ExitVerdict>;
}
