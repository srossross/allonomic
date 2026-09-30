import type { HistoryEntry } from "../core/history";
import { tauriRuntime } from "../adapters/tauri/runtime";
import {
  runAgentPrompt,
  stopAgentPrompt,
  pauseAgent,
  resumeAgent,
  enqueueAgentPrompt,
  didDequeueAgentPrompt,
  answerAgentPrompt,
  recoverAgentSession,
  listInterceptors,
  type AgentTurnSummary,
} from "./server";
import type { InterceptorInfo } from "../core/graph/types";
import type { QueuedPrompt } from "../core/graph/turnControl";
import {
  resolveSettings,
  updateSessionSettings,
  type Settings,
  type SettingsLayer,
  type SettingsPatch,
} from "../core/config/settings";
import {
  loadScopedSettings,
  saveSettingsLayer,
  type ScopedSettings,
  type SettingsScope,
} from "../core/config/scopedSettings";
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
import {
  loadWorkspacesConfig,
  addOrUpdateWorkspace,
  setActiveWorkspaceId,
  renameWorkspace,
  deleteWorkspace,
} from "../persistence/workspaces";
import {
  loadWorkspaceState,
  saveWorkspaceState,
  saveInspectorTabs,
} from "../persistence/workspaceState";
import { listSessions, loadSessionMetadata, saveSessionMetadata } from "../core/session/metadata";
import { rehydrateSession } from "../core/session/rehydration";

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

export function pauseAgentApi(threadId: string, sessionId: string): void {
  pauseAgent(threadId, sessionId);
}

export function resumeAgentApi(threadId: string, sessionId: string): void {
  resumeAgent(threadId, sessionId);
}

export function enqueuePromptApi(threadId: string, sessionId: string, prompt: QueuedPrompt): void {
  enqueueAgentPrompt(threadId, sessionId, prompt);
}

export function didDequeuePromptApi(threadId: string, sessionId: string, id: string): boolean {
  return didDequeueAgentPrompt(threadId, sessionId, id);
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
  await saveWorkspaceState(workspaceDir, state);
}

export async function saveInspectorTabsApi(workspaceDir: string, tabs: string[]): Promise<void> {
  await saveInspectorTabs(workspaceDir, tabs);
}

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
  await saveSessionMetadata(tauriRuntime.fs, workspaceDir, metadata);
}

export async function closeSessionApi(
  workspaceDir: string,
  sessionId: string,
  title: string
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await loadSessionMetadata(tauriRuntime.fs, workspaceDir, sessionId);
  await saveSessionMetadata(tauriRuntime.fs, workspaceDir, {
    ...(existing ?? { sessionId, createdAt: now }),
    title,
    closed: true,
    updatedAt: now,
  });
}

export async function fetchScopedSettingsApi(
  workspaceDir: string,
  sessionId: string | undefined
): Promise<ScopedSettings> {
  return await loadScopedSettings(tauriRuntime, workspaceDir, sessionId);
}

export async function saveSettingsLayerApi(
  workspaceDir: string,
  sessionId: string | undefined,
  scope: SettingsScope,
  layer: SettingsLayer
): Promise<void> {
  await saveSettingsLayer(tauriRuntime, workspaceDir, sessionId, scope, layer);
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
