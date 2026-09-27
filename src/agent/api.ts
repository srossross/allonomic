import type { HistoryEntry } from "../core/history";
import { tauriRuntime } from "../adapters/tauri/runtime";
import {
  resolveDevContainer,
  ensureContainer,
  type DevContainerStatus,
} from "../core/devcontainer";
import {
  runAgentPrompt,
  stopAgentPrompt,
  resumeAgentPrompt,
  type AgentRunConfig,
  type AgentTurnSummary,
} from "./server";
import type {
  WorkspacesConfig,
  WorkspaceItem,
  WorkspaceState,
  SessionMetadata,
  RehydratedSession,
  ModelOption,
  UserPromptValue,
} from "@/types";
import { AVAILABLE_MODELS } from "@/types";
import type { TurnEventListener } from "@/core/turn/events";

export type { AgentRunConfig, AgentTurnSummary } from "./server";

interface AgentCallParams {
  threadId: string;
  sessionId: string;
  workspaceDir?: string;
  history?: HistoryEntry[];
  config?: AgentRunConfig;
  signal?: AbortSignal;
  onEvent?: TurnEventListener;
}

export interface RunAgentParams extends AgentCallParams {
  prompt: string;
}

export interface RespondToPromptParams extends AgentCallParams {
  toolId: string;
  value: UserPromptValue;
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

export async function respondToPromptApi({
  threadId,
  toolId,
  value,
  ...options
}: RespondToPromptParams): Promise<AgentTurnSummary> {
  return await resumeAgentPrompt(threadId, toolId, value, options);
}

export async function getDevContainerStatusApi(
  workspaceDir?: string
): Promise<{ containerId: string | null; status?: DevContainerStatus }> {
  if (!workspaceDir) {
    return { containerId: null, status: "not_setup" };
  }
  try {
    const { containerId, status } = await resolveDevContainer(tauriRuntime, workspaceDir);
    return { containerId, status };
  } catch {
    return { containerId: null, status: "not_setup" };
  }
}

export async function startContainerApi(workspaceDir: string): Promise<void> {
  await ensureContainer(tauriRuntime, workspaceDir);
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

import { loadWorkspaceState, saveWorkspaceState } from "../persistence/workspaceState";

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

// Models API
export async function fetchModelsApi(): Promise<ModelOption[]> {
  return AVAILABLE_MODELS;
}
