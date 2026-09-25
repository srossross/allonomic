import type { ToolCallInfo } from "./tools";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  thinkingDurationSeconds?: number;
  toolCalls?: ToolCallInfo[];
}

export interface ContextMessage {
  role: string;
  content?: unknown;
  name?: string;
  tool_calls?: Array<{ name: string; args: unknown; id?: string }>;
  thinking?: string;
}

export interface ModelOption {
  id: string;
  label: string;
  hasThinking: boolean;
}

export const DEFAULT_MODEL_ID = "gemini-3.8-flash";

export const AVAILABLE_MODELS: ModelOption[] = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", hasThinking: true },
  { id: "gemini-3.8-pro", label: "Gemini 3.8 Pro", hasThinking: true },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hasThinking: true },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hasThinking: true },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", hasThinking: true },
];

export type ThinkingLevel = "Off" | "Low" | "Medium" | "High";

export type ExecutionMode = "manual" | "accept edits";

export interface ModeOption {
  id: ExecutionMode;
  label: string;
  description: string;
}

export const AVAILABLE_MODES: ModeOption[] = [
  { id: "manual", label: "Manual", description: "Prompt for approvals" },
  { id: "accept edits", label: "Accept edits", description: "Auto-apply code edits" },
];
