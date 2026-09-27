import type { GovernorState } from "@/core/governor/types";
import {
  DEFAULT_MODEL_ID,
  type Message,
  type ContextMessage,
  type ThinkingLevel,
  type ExecutionMode,
} from "./chat";
import type { ConsoleEvent } from "./inspector";
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
  showContext?: boolean;
  enabledTools?: string[];
  governorState: GovernorState;
  loading: boolean;
  hasUnread?: boolean;
  selectedModel?: string;
  thinkingLevel?: ThinkingLevel;
  executionMode?: ExecutionMode;
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
    enabledTools: INITIAL_TOOLS,
    governorState: {
      intent_stack: [],
      completed_intents: [],
      global_constraints: [],
    },
    loading: false,
    selectedModel: DEFAULT_MODEL_ID,
    thinkingLevel: "Low",
    executionMode: "manual",
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
    enabledTools: INITIAL_TOOLS,
    governorState: { intent_stack: [], completed_intents: [], global_constraints: [] },
    loading: false,
    selectedModel: DEFAULT_MODEL_ID,
    thinkingLevel: "Low",
    executionMode: "manual",
  };
}
