import type { ThinkingLevel, Message, ContextMessage, ExecutionMode } from "./chat";
import type { ConsoleEvent } from "./inspector";
import type { GovernorState } from "./tab";

export interface WorkspaceItem {
  id: string;
  name: string;
  path: string;
  lastOpened?: string;
}

export interface WorkspacesConfig {
  activeWorkspaceId?: string;
  workspaces: WorkspaceItem[];
}

export interface WorkspaceState {
  activeTabId: string;
  openTabIds: string[];
}

export interface SessionMetadata {
  sessionId: string;
  title: string;
  closed: boolean;
  createdAt: string;
  updatedAt: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  executionMode?: ExecutionMode;
  enabledTools?: string[];
  turnCount?: number;
  lastPrompt?: string;
}

export interface RehydratedSession {
  metadata: SessionMetadata;
  messages: Message[];
  contextMessages: ContextMessage[];
  consoleEvents: ConsoleEvent[];
  governorState: GovernorState;
  nextTurnIndex: number;
}
