import type { GovernorState } from "@/core/governor/types";
import { EMPTY_GOVERNOR_STATE } from "@/core/governor/reducer";
import type { InterceptorSettings } from "@/core/config/settings";
import type { Profile } from "@/core/turn/profile";
import type { QueuedPrompt } from "@/core/graph/turnControl";
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
  kind?: "settings";
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
  collapseWorkerText?: boolean;
  interceptorSettings?: Record<string, InterceptorSettings>;
  loadErrors?: SessionLoadError[];
  contextTokens?: number;
  waitingOn?: string;
  profile?: Profile;
  queuedPrompts?: QueuedPrompt[];
  pauseState?: "pausing" | "paused";
  queueHeld?: boolean;
}

export const INITIAL_TOOLS = AVAILABLE_TOOLS.map((t) => t.name);

export const THINKING_BUDGETS: Record<ThinkingLevel, number> = {
  Off: 0,
  Low: 1024,
  Medium: 4096,
  High: 8192,
};

export const PLACEHOLDER_TAB_ID = "tab-1";
export const DEFAULT_CHAT_TITLE = "New chat";
export const SETTINGS_TAB_ID = "settings";

export function createSettingsTab(projectId: string): TabData {
  return {
    id: SETTINGS_TAB_ID,
    kind: "settings",
    title: "Settings",
    projectId,
    threadId: SETTINGS_TAB_ID,
    messages: [],
    governorState: structuredClone(EMPTY_GOVERNOR_STATE),
    loading: false,
  };
}

export function createInitialTab(projectId: string = "proj-1"): TabData {
  return {
    id: PLACEHOLDER_TAB_ID,
    title: DEFAULT_CHAT_TITLE,
    projectId,
    threadId: "thread-1",
    messages: [],
    governorState: structuredClone(EMPTY_GOVERNOR_STATE),
    loading: false,
  };
}

export function createNewTab(projectId: string): TabData {
  const newId = `session-${Date.now()}`;
  return {
    id: newId,
    title: DEFAULT_CHAT_TITLE,
    projectId,
    threadId: newId,
    messages: [],
    governorState: structuredClone(EMPTY_GOVERNOR_STATE),
    loading: false,
  };
}
