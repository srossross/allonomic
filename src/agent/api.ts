import type { HistoryEntry } from "../core/history";
import { tauriRuntime } from "../adapters/tauri/runtime";
import {
  runAgentPrompt,
  stopAgentPrompt,
  answerAgentPrompt,
  recoverAgentSession,
  listInterceptors,
  type AgentTurnSummary,
} from "./server";
import type { InterceptorInfo } from "../core/graph/types";
import {
  resolveSettings,
  updateSessionSettings,
  type Settings,
  type SettingsPatch,
} from "../core/config/settings";
import type {
  WorkspacesConfig,
  WorkspaceItem,
  WorkspaceState,
  SessionMetadata,
  RehydratedSession,
  ModelOption,
  UserPromptValue,
} from "@/types";
import { loadModels } from "../core/models";
import type { RecoverableCall, TurnEventListener } from "@/core/turn/events";

export type { AgentTurnSummary } from "./server";

interface AgentCallParams {
  threadId: string;
  sessionId: string;
  workspaceDir?: string;
  history?: HistoryEntry[];
  signal?: AbortSignal;
  onEvent?: TurnEventListener;
}

export interface RunAgentParams extends AgentCallParams {
  prompt: string;
}

export async function runAgentPromptApi({
  prompt,
  threadId,
  ...options
}: RunAgentParams): Promise<AgentTurnSummary> {
  return await runAgentPrompt(prompt, threadId, options);
}

export async function stopAgentPromptApi(threadId: string, sessionId?: string): Promise<void> {
  await stopAgentPrompt(threadId, sessionId);
}

export interface RecoverSessionParams extends AgentCallParams {
  calls: RecoverableCall[];
}

export async function recoverSessionApi({
  threadId,
  calls,
  ...options
}: RecoverSessionParams): Promise<AgentTurnSummary> {
  return await recoverAgentSession(threadId, calls, options);
}

export async function fetchInterceptorsApi(
  workspaceDir: string | undefined,
  sessionId: string
): Promise<InterceptorInfo[]> {
  return await listInterceptors(workspaceDir, sessionId);
}

export async function answerPromptApi(
  workspaceDir: string | undefined,
  sessionId: string,
  promptId: string,
  value: UserPromptValue
): Promise<void> {
  await answerAgentPrompt(workspaceDir, sessionId, promptId, value);
}

import {
  loadWorkspacesConfig,
  addOrUpdateWorkspace,
  setActiveWorkspaceId,
  renameWorkspace,
  deleteWorkspace,
} from "../persistence/workspaces";

// Workspaces API
export async function fetchWorkspacesApi(): Promise<WorkspacesConfig> {
  return await loadWorkspacesConfig();
}

export async function addWorkspaceApi(workspace: WorkspaceItem): Promise<WorkspacesConfig> {
  return await addOrUpdateWorkspace(workspace);
}

export async function setActiveWorkspaceApi(workspaceId: string): Promise<WorkspacesConfig> {
  return await setActiveWorkspaceId(workspaceId);
}

export async function renameWorkspaceApi(
  workspaceId: string,
  newName: string
): Promise<WorkspacesConfig> {
  return await renameWorkspace(workspaceId, newName);
}

export async function deleteWorkspaceApi(workspaceId: string): Promise<WorkspacesConfig> {
  return await deleteWorkspace(workspaceId);
}

import {
  loadWorkspaceState,
  saveWorkspaceState,
  saveInspectorTabs,
} from "../persistence/workspaceState";

// Workspace State API (<workspaceDir>/.allonomic/workspace.yml)
export async function fetchWorkspaceStateApi(
  workspaceDir: string
): Promise<{ state: WorkspaceState | null }> {
  const state = await loadWorkspaceState(workspaceDir);
  return { state };
}

export async function saveWorkspaceStateApi(
  workspaceDir: string,
  state: WorkspaceState
): Promise<void> {
  try {
    await saveWorkspaceState(workspaceDir, state);
  } catch (error) {
    console.error("Failed to save workspace state:", error);
    globalThis.alert(
      "Failed to save workspace state: " + (error instanceof Error ? error.message : String(error))
    );
  }
}

export async function saveInspectorTabsApi(workspaceDir: string, tabs: string[]): Promise<void> {
  try {
    await saveInspectorTabs(workspaceDir, tabs);
  } catch (error) {
    console.error("Failed to save inspector tabs:", error);
    globalThis.alert(
      "Failed to save inspector tabs: " + (error instanceof Error ? error.message : String(error))
    );
  }
}

import { listSessions, saveSessionMetadata } from "../core/session/metadata";
import { rehydrateSession } from "../core/session/rehydration";

// Sessions API
export async function fetchSessionsApi(
  workspaceDir: string
): Promise<{ sessions: SessionMetadata[] }> {
  const sessions = await listSessions(tauriRuntime.fs, workspaceDir);
  return { sessions };
}

export async function rehydrateSessionApi(
  workspaceDir: string,
  sessionId: string
): Promise<RehydratedSession> {
  return await rehydrateSession(tauriRuntime.fs, workspaceDir, sessionId);
}

export async function saveSessionMetadataApi(
  workspaceDir: string,
  metadata: SessionMetadata
): Promise<void> {
  try {
    await saveSessionMetadata(tauriRuntime.fs, workspaceDir, metadata);
  } catch (error) {
    console.error("Failed to save session metadata:", error);
    globalThis.alert(
      "Failed to save session metadata: " + (error instanceof Error ? error.message : String(error))
    );
  }
}

export async function fetchSessionSettingsApi(
  workspaceDir: string,
  sessionId: string
): Promise<Settings> {
  return await resolveSettings(tauriRuntime, workspaceDir, sessionId);
}

export async function updateSessionSettingsApi(
  workspaceDir: string,
  sessionId: string,
  patch: SettingsPatch
): Promise<Settings> {
  return await updateSessionSettings(tauriRuntime, workspaceDir, sessionId, patch);
}

// Models API
export async function fetchModelsApi(workspaceDir?: string): Promise<ModelOption[]> {
  return await loadModels(tauriRuntime, workspaceDir);
}

export async function fetchPathRootsApi(): Promise<{ app: string; user: string }> {
  const [app, user] = await Promise.all([
    tauriRuntime.paths.resource("app-data"),
    tauriRuntime.paths.home(),
  ]);
  return { app, user };
}
