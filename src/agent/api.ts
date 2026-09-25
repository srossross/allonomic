import type {
  ConsoleEvent,
  ContextMessage,
  ToolCallInfo,
  WorkspacesConfig,
  WorkspaceItem,
  WorkspaceState,
  SessionMetadata,
  RehydratedSession,
  ExecutionMode,
  ModelOption,
} from "@/types";
import { AVAILABLE_MODELS } from "@/types";
import type { GovernorState } from "@/types/tab";

export interface RunAgentParams {
  prompt: string;
  threadId: string;
  sessionId?: string;
  workspaceDir?: string;
  enabledTools: string[];
  modelName: string;
  thinkingBudget: number;
  executionMode?: ExecutionMode;
  history?: Array<{
    role: string;
    content: string;
    tool_calls?: Record<string, unknown>[];
    tool_call_id?: string;
    name?: string;
  }>;
  signal?: AbortSignal;
}

export interface RunAgentResponse {
  turnSteps?: Array<{
    role: "assistant";
    content: string;
    thinking?: string;
    thinkingDurationSeconds?: number;
    toolCalls?: ToolCallInfo[];
  }>;
  assistantMessage?: string;
  thinking?: string;
  thinkingDurationSeconds?: number;
  toolCalls?: ToolCallInfo[];
  contextMessages?: ContextMessage[];
  turnEvents?: ConsoleEvent[];
  governorState?: GovernorState;
}

export async function runAgentPromptApi(parameters: RunAgentParams): Promise<RunAgentResponse> {
  const res = await fetch("/api/agent/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: parameters.signal,
    body: JSON.stringify({
      prompt: parameters.prompt,
      threadId: parameters.threadId,
      sessionId: parameters.sessionId || parameters.threadId,
      workspaceDir: parameters.workspaceDir,
      enabledTools: parameters.enabledTools,
      modelName: parameters.modelName,
      thinkingBudget: parameters.thinkingBudget,
      executionMode: parameters.executionMode,
      history: parameters.history,
    }),
  });

  if (!res.ok) {
    let errorMessage = `HTTP ${res.status}`;
    try {
      const errorData: unknown = await res.json();
      if (
        errorData &&
        typeof errorData === "object" &&
        "error" in errorData &&
        typeof errorData.error === "string"
      ) {
        errorMessage = errorData.error;
      }
    } catch {
      // Ignore JSON parse errors on non-ok response
    }
    throw new Error(errorMessage);
  }

  return res.json();
}

export async function stopAgentPromptApi(threadId: string, sessionId?: string): Promise<void> {
  try {
    await fetch("/api/agent/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, sessionId }),
    });
  } catch {
    // Network abort or stop errors can be safely ignored
  }
}

export async function resumeAgentPromptApi(params: {
  threadId: string;
  sessionId: string;
  workspaceDir?: string;
  toolId: string;
  resultString: string;
}): Promise<RunAgentResponse> {
  const res = await fetch("/api/agent/resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    let errorMessage = `HTTP ${res.status}`;
    try {
      const errorData: unknown = await res.json();
      if (
        errorData &&
        typeof errorData === "object" &&
        "error" in errorData &&
        typeof errorData.error === "string"
      ) {
        errorMessage = errorData.error;
      }
    } catch {
      // ignore
    }
    throw new Error(errorMessage);
  }

  return res.json();
}

export interface ApplyWriteParams {
  workspaceDir?: string;
  filePath: string;
  content: string;
}

export async function applyWriteApi(params: ApplyWriteParams): Promise<{ success: boolean; bytesWritten: number }> {
  const res = await fetch("/api/agent/apply-write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Failed to apply write to ${params.filePath}: HTTP ${res.status}`);
  return res.json();
}

export async function executeCommandApi(params: { workspaceDir?: string; command: string }): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const res = await fetch("/api/agent/run-mutating-command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Failed to execute command: HTTP ${res.status}`);
  return res.json();
}

export async function getDevContainerStatusApi(workspaceDir?: string): Promise<{ containerId: string | null }> {
  const params = new URLSearchParams();
  if (workspaceDir) params.append("workspaceDir", workspaceDir);
  const res = await fetch(`/api/devcontainer/status?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to get devcontainer status: HTTP ${res.status}`);
  return res.json();
}

// Workspaces API
export async function fetchWorkspacesApi(): Promise<WorkspacesConfig> {
  const res = await fetch("/api/workspaces");
  if (!res.ok) throw new Error(`Failed to load workspaces: HTTP ${res.status}`);
  return res.json();
}

export async function addWorkspaceApi(workspace: WorkspaceItem): Promise<WorkspacesConfig> {
  const res = await fetch("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(workspace),
  });
  if (!res.ok) throw new Error(`Failed to save workspace: HTTP ${res.status}`);
  return res.json();
}

export async function setActiveWorkspaceApi(workspaceId: string): Promise<WorkspacesConfig> {
  const res = await fetch("/api/workspaces/active", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  });
  if (!res.ok) throw new Error(`Failed to set active workspace: HTTP ${res.status}`);
  return res.json();
}

// Workspace State API (<workspaceDir>/.atomic/workspace.yml)
export async function fetchWorkspaceStateApi(
  workspaceDir: string
): Promise<{ state: WorkspaceState | null }> {
  const res = await fetch(`/api/workspace/state?workspaceDir=${encodeURIComponent(workspaceDir)}`);
  return res.ok ? res.json() : { state: null };
}

export async function saveWorkspaceStateApi(
  workspaceDir: string,
  state: WorkspaceState
): Promise<void> {
  await fetch("/api/workspace/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceDir, state }),
  });
}

// Sessions API
export async function fetchSessionsApi(
  workspaceDir: string
): Promise<{ sessions: SessionMetadata[] }> {
  const res = await fetch(`/api/sessions?workspaceDir=${encodeURIComponent(workspaceDir)}`);
  return res.ok ? res.json() : { sessions: [] };
}

export async function rehydrateSessionApi(
  workspaceDir: string,
  sessionId: string
): Promise<RehydratedSession> {
  const res = await fetch(
    `/api/sessions/rehydrate?workspaceDir=${encodeURIComponent(workspaceDir)}&sessionId=${encodeURIComponent(sessionId)}`
  );
  if (!res.ok) throw new Error(`Failed to rehydrate session ${sessionId}: HTTP ${res.status}`);
  return res.json();
}

export async function saveSessionMetadataApi(
  workspaceDir: string,
  metadata: SessionMetadata
): Promise<void> {
  await fetch("/api/sessions/metadata", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceDir, metadata }),
  });
}

function isModelOption(item: unknown): item is ModelOption {
  if (!item || typeof item !== "object") return false;
  const id = Reflect.get(item, "id");
  const label = Reflect.get(item, "label");
  const hasThinking = Reflect.get(item, "hasThinking");
  return typeof id === "string" && typeof label === "string" && typeof hasThinking === "boolean";
}

// Models API
export async function fetchModelsApi(): Promise<ModelOption[]> {
  try {
    const res = await fetch("/api/models");
    if (res.ok) {
      const data: unknown = await res.json();
      if (
        data &&
        typeof data === "object" &&
        "models" in data &&
        Array.isArray(data.models)
      ) {
        const valid = data.models.filter(isModelOption);
        if (valid.length > 0) return valid;
      }
    }
  } catch (error) {
    console.warn("[API] Failed to fetch dynamic models from server:", error);
  }
  return AVAILABLE_MODELS;
}

