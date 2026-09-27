import { loadWorkerPrompt } from "./worker";
import { tauriRuntime } from "../adapters/tauri/runtime";
import { join } from "../core/paths";
import { AgentRunner } from "../core/graph/runner";
import { GovernorInterceptor } from "../core/governor/interceptor";
import { resumeFromDir } from "../core/telemetry/sessionReplay";
import { loadSessionMetadata, saveSessionMetadata } from "../core/session/metadata";
import type { ExecutionMode, UserPromptValue } from "../types";
import type { TurnEventListener } from "../core/turn/events";
import { createLogger } from "../core/log";
import type { HistoryEntry } from "../core/history";

const serverLog = createLogger("agent/server");

interface AgentInstance {
  governor: GovernorInterceptor;
  runner: AgentRunner;
  workspaceDir: string;
  sessionId: string;
}

const runnersMap = new Map<string, AgentInstance>();

function getSessionKey(workspaceDir: string, sessionId: string): string {
  return `${workspaceDir}:::${sessionId}`;
}

async function replaySession(workspaceDir: string, sessionId: string) {
  try {
    return await resumeFromDir(
      tauriRuntime.fs,
      join(workspaceDir, ".allonomic/sessions", sessionId)
    );
  } catch (error) {
    serverLog.error("replay:failed", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
}

export async function getAgentInstance(
  workspaceDir?: string,
  sessionId?: string
): Promise<AgentInstance> {
  const effectiveWorkspace = workspaceDir ? await tauriRuntime.paths.resolve(workspaceDir) : ".";
  const effectiveSessionId = sessionId || "default-session";
  const key = getSessionKey(effectiveWorkspace, effectiveSessionId);

  const existing = runnersMap.get(key);
  if (existing) return existing;

  const replay = await replaySession(effectiveWorkspace, effectiveSessionId);
  const governor = new GovernorInterceptor({
    runtime: tauriRuntime,
    initialState: replay?.governorState,
  });
  const runner = new AgentRunner({
    runtime: tauriRuntime,
    systemPrompt: await loadWorkerPrompt(tauriRuntime, effectiveWorkspace),
    workspaceDir: effectiveWorkspace,
    sessionId: effectiveSessionId,
    initialTurnIndex: replay?.nextTurnIndex ?? 1,
    interceptors: [governor],
  });

  const instance: AgentInstance = {
    governor,
    runner,
    workspaceDir: effectiveWorkspace,
    sessionId: effectiveSessionId,
  };
  runnersMap.set(key, instance);
  return instance;
}

export interface AgentRunConfig {
  executionMode?: ExecutionMode;
  enabledTools?: string[];
  modelName?: string;
  thinkingBudget?: number;
}

export interface AgentCallOptions {
  sessionId: string;
  workspaceDir?: string;
  history?: HistoryEntry[];
  config?: AgentRunConfig;
  signal?: AbortSignal;
  onEvent?: TurnEventListener;
}

export interface AgentTurnSummary {
  turnIndex: number;
}

async function prepareInstance(options: AgentCallOptions): Promise<AgentInstance> {
  const instance = await getAgentInstance(options.workspaceDir, options.sessionId);
  const { runner, governor } = instance;
  const config = options.config ?? {};
  runner.setExecutionMode(config.executionMode);
  if (config.enabledTools) runner.setEnabledTools(config.enabledTools);
  runner.setModelAndThinking(config.modelName, config.thinkingBudget ?? 1024);
  if (config.modelName) governor.setModelName(config.modelName);
  return instance;
}

async function touchSessionMetadata(
  instance: AgentInstance,
  turnIndex: number,
  prompt: string | null,
  config?: AgentRunConfig
) {
  try {
    const existing = await loadSessionMetadata(
      tauriRuntime.fs,
      instance.workspaceDir,
      instance.sessionId
    );
    const now = new Date().toISOString();
    await saveSessionMetadata(tauriRuntime.fs, instance.workspaceDir, {
      sessionId: instance.sessionId,
      title: existing?.title || prompt?.slice(0, 30) || "Chat",
      closed: existing?.closed ?? false,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      model: config?.modelName ?? existing?.model ?? instance.governor.getModelName(),
      thinkingLevel: existing?.thinkingLevel || "Low",
      enabledTools: config?.enabledTools || existing?.enabledTools,
      turnCount: turnIndex,
      lastPrompt: prompt ?? existing?.lastPrompt,
    });
  } catch (error) {
    console.error(`[AgentServer] Failed to save session metadata:`, error);
    globalThis.alert(
      "Failed to save session metadata: " + (error instanceof Error ? error.message : String(error))
    );
  }
}

export async function runAgentPrompt(
  prompt: string,
  threadId: string,
  options: AgentCallOptions
): Promise<AgentTurnSummary> {
  const instance = await prepareInstance(options);
  const { turnIndex } = await instance.runner.run(prompt, threadId, {
    history: options.history,
    signal: options.signal,
    onEvent: options.onEvent,
  });
  await touchSessionMetadata(instance, turnIndex, prompt, options.config);
  return { turnIndex };
}

export async function resumeAgentPrompt(
  threadId: string,
  toolId: string,
  value: UserPromptValue,
  options: AgentCallOptions
): Promise<AgentTurnSummary> {
  const instance = await prepareInstance(options);
  serverLog.info("resume:start", {
    threadId,
    sessionId: options.sessionId,
    toolId,
    historyLength: options.history?.length ?? 0,
  });
  const { turnIndex } = await instance.runner.resume(threadId, toolId, value, {
    history: options.history,
    signal: options.signal,
    onEvent: options.onEvent,
  });
  await touchSessionMetadata(instance, turnIndex, null, options.config);
  return { turnIndex };
}

export async function stopAgentPrompt(threadId: string, sessionId?: string) {
  let isStopped = false;
  for (const instance of runnersMap.values()) {
    if (
      instance.sessionId === threadId ||
      instance.sessionId === sessionId ||
      instance.runner.abort(threadId)
    ) {
      isStopped = true;
    }
  }
  return isStopped;
}

export async function getGovernorState(workspaceDir?: string, sessionId?: string) {
  const { governor } = await getAgentInstance(workspaceDir, sessionId);
  return governor.state;
}

export async function getInstalledInjectors(workspaceDir?: string, sessionId?: string) {
  const { governor } = await getAgentInstance(workspaceDir, sessionId);
  return [
    {
      id: "governor",
      name: governor.name || "Governor",
      type: "Pipeline Interceptor",
      status: "active",
      modelName: governor.getModelName?.() || "gemini-3.8-flash",
      description:
        "Monitors and intercepts agent actions across execution phases to enforce policy, constraints, and goal satisfaction verification.",
      phases: [
        {
          name: "Entry Intercept",
          hook: "onUserPrompt",
          description: "Extracts intent stack and loads constraints from agents/CONSTRAINTS.md",
        },
        {
          name: "Pre-Tool Intercept",
          hook: "onPreToolCall",
          description: "Authorizes or blocks tool calls against policy rules",
        },
        {
          name: "Exit Intercept",
          hook: "onAgentExit",
          description: "Verifies intent completion and triggers automatic retries if unsatisfied",
        },
      ],
      constraintsPath: "agents/CONSTRAINTS.md",
    },
  ];
}
