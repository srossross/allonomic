import type { GovernorState } from "@/core/governor/types";
import type { InterceptorSettings } from "@/core/config/settings";
import type { Profile } from "@/core/turn/profile";
import {
  type Message,
  type ContextMessage,
  type ThinkingLevel,
  type ExecutionMode,
  type GovernorMode,
} from "./chat";
import type { AgentFileRow, ConsoleEvent } from "./inspector";
import type { SessionLoadError } from "./persistence";
import { AVAILABLE_TOOLS } from "./tools";

export type { GovernorState } from "@/core/governor/types";

export interface TabData {
  id: string;
  title: string;
  projectId: string;
  threadId: string;
  messages: Message[];
  contextMessages?: ContextMessage[];
  consoleEvents?: ConsoleEvent[];
  agentFiles?: AgentFileRow[];
  showContext?: boolean;
  enabledTools?: string[];
  governorState: GovernorState;
  loading: boolean;
  hasUnread?: boolean;
  selectedModel?: string;
  thinkingLevel?: ThinkingLevel;
  executionMode?: ExecutionMode;
  hasNetworkAccess?: boolean;
  governorMode?: GovernorMode;
  teacherEnabled?: boolean;
  interceptorSettings?: Record<string, InterceptorSettings>;
  loadErrors?: SessionLoadError[];
  contextTokens?: number;
  waitingOn?: string;
  profile?: Profile;
}

export const INITIAL_TOOLS = AVAILABLE_TOOLS.map((t) => t.name);

export const THINKING_BUDGETS: Record<ThinkingLevel, number> = {
  Off: 0,
  Low: 1024,
  Medium: 4096,
  High: 8192,
};

export const PLACEHOLDER_TAB_ID = "tab-1";

export function createInitialTab(projectId: string = "proj-1"): TabData {
  return {
    id: PLACEHOLDER_TAB_ID,
    title: "Chat 1",
    projectId,
    threadId: "thread-1",
    messages: [],
    governorState: {
      intent_stack: [],
      completed_intents: [],
      false_completions: [],
    },
    loading: false,
  };
}

export function createNewTab(projectId: string, index: number): TabData {
  const newId = `session-${Date.now()}`;
  return {
    id: newId,
    title: `Chat ${index}`,
    projectId,
    threadId: newId,
    messages: [],
    governorState: { intent_stack: [], completed_intents: [], false_completions: [] },
    loading: false,
  };
}
