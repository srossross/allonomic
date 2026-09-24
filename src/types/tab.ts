import type { UserIntent } from "@/interceptor-agents/governor/types";
import type { Message, ContextMessage, ThinkingLevel, ExecutionMode } from "./chat";
import type { ConsoleEvent } from "./inspector";

export interface GovernorState {
  intent_stack: UserIntent[];
  completed_intents: UserIntent[];
  global_constraints: string[];
}

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
  selectedModel?: string;
  thinkingLevel?: ThinkingLevel;
  executionMode?: ExecutionMode;
}

export const INITIAL_TOOLS = ["read_file", "write_file", "list_files", "run_command"];

export const THINKING_BUDGETS: Record<ThinkingLevel, number> = {
  Off: 0,
  Low: 1024,
  Medium: 4096,
  High: 8192,
};

export function createInitialTab(projectId: string = "proj-1"): TabData {
  return {
    id: "tab-1",
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
    selectedModel: "gemini-2.5-flash",
    thinkingLevel: "High",
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
    selectedModel: "gemini-2.5-flash",
    thinkingLevel: "High",
    executionMode: "manual",
  };
}

