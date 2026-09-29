import type { Message, ContextMessage } from "./chat";
import type { AgentFileRow, ConsoleEvent } from "./inspector";
import type { GovernorState } from "./tab";
import type { RecoverableCall } from "../core/turn/events";
import type { Profile } from "../core/turn/profile";

export interface WorkspaceItem {
  id: string;
  name: string;
  path: string;
  lastOpened?: string;
  archived?: boolean;
}

export interface WorkspacesConfig {
  activeWorkspaceId?: string;
  workspaces: WorkspaceItem[];
}

export interface WorkspaceState {
  activeTabId: string;
  openTabIds: string[];
  inspectorTabs?: string[];
}

export interface SessionMetadata {
  sessionId: string;
  title: string;
  closed: boolean;
  createdAt: string;
  updatedAt: string;
  turnCount?: number;
  lastPrompt?: string;
}

export interface SessionLoadError {
  turnIndex: number | null;
  message: string;
}

export interface RehydratedSession {
  metadata: SessionMetadata;
  messages: Message[];
  contextMessages: ContextMessage[];
  consoleEvents: ConsoleEvent[];
  agentFiles: AgentFileRow[];
  governorState: GovernorState;
  contextTokens?: number;
  profile: Profile;
  nextTurnIndex: number;
  loadErrors: SessionLoadError[];
  unansweredCalls: RecoverableCall[];
}
