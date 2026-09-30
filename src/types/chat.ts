import type { ToolCallInfo } from "./tools";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  thinkingDurationSeconds?: number;
  toolCalls?: ToolCallInfo[];
  isError?: boolean;
  isQueued?: boolean;
  brief?: { interceptor: string; text: string; doneWhen: string[] };
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
  thinking: ThinkingLevel[];
  inputTokenLimit: number;
}

export const DEFAULT_MODEL_ID = "gemini-3.8-flash";

export const THINKING_LEVELS = ["Off", "Low", "Medium", "High"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export type ExecutionMode = "restricted" | "read" | "write" | "god";

export type AccessLevel = 1 | 2 | 3 | 4;

export const EXECUTION_MODE_LEVELS: Record<ExecutionMode, AccessLevel> = {
  restricted: 1,
  read: 2,
  write: 3,
  god: 4,
};

export const LEVEL_MODES: Record<AccessLevel, ExecutionMode> = {
  1: "restricted",
  2: "read",
  3: "write",
  4: "god",
};

export const DEFAULT_EXECUTION_MODE: ExecutionMode = "restricted";

export const GOVERNOR_MODES = ["off", "no-false-completion", "full"] as const;

export type GovernorMode = (typeof GOVERNOR_MODES)[number];

export const DEFAULT_GOVERNOR_MODE: GovernorMode = "full";

export interface ModeOption {
  id: ExecutionMode;
  label: string;
  description: string;
}

export const AVAILABLE_MODES: ModeOption[] = [
  { id: "restricted", label: "restricted", description: "Prompt for anything above level 1" },
  { id: "read", label: "read", description: "Prompt for anything above level 2" },
  { id: "write", label: "write", description: "Prompt for anything above level 3" },
  { id: "god", label: "god", description: "Never prompt" },
];
