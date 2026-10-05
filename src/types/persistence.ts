import type { Message, ContextMessage } from "./chat";
import type { AgentFileRow, ConsoleEvent } from "./inspector";
import type { GovernorState } from "./tab";
import type { RecoverableCall } from "../core/turn/events";
import type { Profile } from "../core/turn/profile";
import type { TokenUsage } from "../core/turn/usage";
import type { TurnTree } from "../core/turn/branches";
import type { GroupColor } from "./groupColors";

export interface WorkspaceItem {
  id: string;
  name: string;
  path: string;
  lastOpened?: string;
  archived?: boolean;
  groupId?: string;
}

export interface WorkspaceGroup {
  id: string;
  name: string;
  color: GroupColor;
  collapsed?: boolean;
}

export interface WorkspacesConfig {
  activeWorkspaceId?: string;
  workspaces: WorkspaceItem[];
  groups: WorkspaceGroup[];
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
  tokenUsage: TokenUsage;
  profile: Profile;
  turnTree: TurnTree;
  nextTurnIndex: number;
  loadErrors: SessionLoadError[];
  unansweredCalls: RecoverableCall[];
}
