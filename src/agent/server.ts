import { loadWorkerPrompt } from "./worker";
import { toContextFiles } from "../core/contextFiles";
import { tauriRuntime } from "../adapters/tauri/runtime";
import { join } from "../core/paths";
import { AgentRunner } from "../core/graph/runner";
import { GovernorInterceptor } from "../core/governor/interceptor";
import { ToolTeacherInterceptor } from "../core/teacher/interceptor";
import { describeInterceptor } from "../core/graph/interceptorHooks";
import type { InterceptorInfo } from "../core/graph/types";
import type { QueuedPrompt } from "../core/graph/turnControl";
import { resumeFromDir } from "../core/telemetry/sessionReplay";
import { loadSessionMetadata, saveSessionMetadata } from "../core/session/metadata";
import { resolveSettings } from "../core/config/settings";
import { loadModels } from "../core/models";
import { generateChatTitle } from "../core/session/title";
import {
  DEFAULT_CHAT_TITLE,
  THINKING_BUDGETS,
  THINKING_LEVELS,
  type ThinkingLevel,
  type UserPromptValue,
} from "../types";
import type { RecoverableCall, TurnEventListener } from "../core/turn/events";
import { createLogger } from "../core/log";
import type { HistoryEntry } from "../core/history";

const serverLog = createLogger("agent/server");

interface AgentInstance {
  governor: GovernorInterceptor;
  teacher: ToolTeacherInterceptor;
  runner: AgentRunner;
  workspaceDir: string;
  sessionId: string;
}

const runnersMap = new Map<string, AgentInstance>();
const pendingInstances = new Map<string, Promise<AgentInstance>>();

function getSessionKey(workspaceDir: string, sessionId: string): string {
  return `${workspaceDir}:::${sessionId}`;
}

async function replaySession(workspaceDir: string, sessionId: string) {
  try {
    return {
      replay: await resumeFromDir(
        tauriRuntime.fs,
        join(workspaceDir, ".allonomic/sessions", sessionId)
      ),
    };
  } catch (error) {
    return { warnings: [{ source: "session replay (started fresh)", error }] };
  }
}

async function getAgentInstance(workspaceDir?: string, sessionId?: string): Promise<AgentInstance> {
  const effectiveWorkspace = workspaceDir ? await tauriRuntime.paths.resolve(workspaceDir) : ".";
  const effectiveSessionId = sessionId || "default-session";
  const key = getSessionKey(effectiveWorkspace, effectiveSessionId);

  const existing = runnersMap.get(key);
  if (existing) return existing;

  const pending = pendingInstances.get(key);
  if (pending) return await pending;

  const creating = createAgentInstance(effectiveWorkspace, effectiveSessionId);
  pendingInstances.set(key, creating);
  try {
    const instance = await creating;
    runnersMap.set(key, instance);
    return instance;
  } finally {
    pendingInstances.delete(key);
  }
}

async function createAgentInstance(
  effectiveWorkspace: string,
  effectiveSessionId: string
): Promise<AgentInstance> {
  const { replay, warnings } = await replaySession(effectiveWorkspace, effectiveSessionId);
  const governor = new GovernorInterceptor({
    runtime: tauriRuntime,
    initialState: replay?.governorState,
  });
  const teacher = new ToolTeacherInterceptor({ runtime: tauriRuntime });
  const workerPrompt = await loadWorkerPrompt(tauriRuntime, effectiveWorkspace);
  const runner = new AgentRunner({
    runtime: tauriRuntime,
    systemPrompt: workerPrompt.prompt,
    contextFiles: toContextFiles(workerPrompt.files),
    workspaceDir: effectiveWorkspace,
    sessionId: effectiveSessionId,
    initialTurnIndex: replay?.nextTurnIndex ?? 1,
    interceptors: [teacher, governor],
    startupWarnings: warnings,
    executionMode: async () => {
      const settings = await resolveSettings(tauriRuntime, effectiveWorkspace, effectiveSessionId);
      return settings.executionMode;
    },
  });

  return {
    governor,
    teacher,
    runner,
    workspaceDir: effectiveWorkspace,
    sessionId: effectiveSessionId,
  };
}

export interface AgentCallOptions {
  sessionId: string;
  workspaceDir?: string;
  history?: HistoryEntry[];
  signal?: AbortSignal;
  onEvent?: TurnEventListener;
}

export interface AgentTurnSummary {
  turnIndex: number;
  title?: string;
}

async function prepareInstance(options: AgentCallOptions): Promise<AgentInstance> {
  const instance = await getAgentInstance(options.workspaceDir, options.sessionId);
  const { runner, governor, teacher } = instance;
  const settings = await resolveSettings(tauriRuntime, instance.workspaceDir, instance.sessionId);
  runner.setEnabledTools(settings.enabledTools);
  const models = await loadModels(tauriRuntime, instance.workspaceDir);
  const supportedBudget = (model: string, level?: ThinkingLevel) => {
    const levels = models.find((m) => m.id === model)?.thinking ?? THINKING_LEVELS;
    return THINKING_BUDGETS[level && levels.includes(level) ? level : levels[0]];
  };
  runner.setModelAndThinking(
    settings.model,
    supportedBudget(settings.model, settings.thinkingLevel)
  );
  for (const interceptor of [governor, teacher]) {
    const { model = settings.model, thinkingLevel } = settings.interceptors[interceptor.name] ?? {};
    interceptor.setModel(model, supportedBudget(model, thinkingLevel));
  }
  governor.setHasFalseCompletions(settings.governorMode === "full");
  governor.setIsEnabled(settings.governorMode !== "off");
  teacher.setIsEnabled(settings.teacherEnabled);
  return instance;
}

export async function listInterceptors(
  workspaceDir: string | undefined,
  sessionId: string
): Promise<InterceptorInfo[]> {
  const { runner } = await prepareInstance({ workspaceDir, sessionId });
  return runner.interceptors.map((interceptor) => describeInterceptor(interceptor));
}

async function touchSessionMetadata(
  instance: AgentInstance,
  turnIndex: number,
  prompt: string | null
) {
  const existing = await loadSessionMetadata(
    tauriRuntime.fs,
    instance.workspaceDir,
    instance.sessionId
  );
  const now = new Date().toISOString();
  await saveSessionMetadata(tauriRuntime.fs, instance.workspaceDir, {
    sessionId: instance.sessionId,
    title: existing?.title || DEFAULT_CHAT_TITLE,
    closed: existing?.closed ?? false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    turnCount: turnIndex,
    lastPrompt: prompt ?? existing?.lastPrompt,
  });
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
  await touchSessionMetadata(instance, turnIndex, prompt);
  return { turnIndex, title: await titleUntitledSession(instance, prompt) };
}

async function titleUntitledSession(
  instance: AgentInstance,
  prompt: string
): Promise<string | undefined> {
  const metadata = await loadSessionMetadata(
    tauriRuntime.fs,
    instance.workspaceDir,
    instance.sessionId
  );
  if (!metadata || metadata.title !== DEFAULT_CHAT_TITLE) return undefined;
  let title: string;
  try {
    title = await generateChatTitle(prompt);
  } catch (error) {
    serverLog.child({ sessionId: instance.sessionId }).warn({ error }, "title:failed");
    return undefined;
  }
  await saveSessionMetadata(tauriRuntime.fs, instance.workspaceDir, { ...metadata, title });
  return title;
}

export async function recoverAgentSession(
  threadId: string,
  calls: RecoverableCall[],
  options: AgentCallOptions
): Promise<AgentTurnSummary> {
  const instance = await prepareInstance(options);
  serverLog
    .child({ sessionId: instance.sessionId })
    .info({ threadId, calls: calls.length }, "recover:start");
  const { turnIndex } = await instance.runner.recover(threadId, calls, {
    history: options.history,
    signal: options.signal,
    onEvent: options.onEvent,
  });
  await touchSessionMetadata(instance, turnIndex, null);
  return { turnIndex };
}

export async function answerAgentPrompt(
  workspaceDir: string | undefined,
  sessionId: string,
  promptId: string,
  value: UserPromptValue
): Promise<void> {
  const instance = await getAgentInstance(workspaceDir, sessionId);
  instance.runner.answerPrompt(promptId, value);
}

export async function stopAgentPrompt(threadId: string, sessionId?: string) {
  let isStopped = false;
  for (const instance of runnersMap.values()) {
    if (sessionId && instance.sessionId !== sessionId) continue;
    if (instance.runner.abort(threadId)) isStopped = true;
  }
  return isStopped;
}

function runnersFor(sessionId: string): AgentRunner[] {
  const runners: AgentRunner[] = [];
  for (const instance of runnersMap.values())
    if (instance.sessionId === sessionId) runners.push(instance.runner);
  return runners;
}

export function pauseAgent(threadId: string, sessionId: string): void {
  for (const runner of runnersFor(sessionId)) runner.controls.pause(threadId);
}

export function resumeAgent(threadId: string, sessionId: string): void {
  for (const runner of runnersFor(sessionId)) runner.controls.resume(threadId);
}

export function enqueueAgentPrompt(
  threadId: string,
  sessionId: string,
  prompt: QueuedPrompt
): void {
  for (const runner of runnersFor(sessionId)) runner.controls.enqueue(threadId, prompt);
}

export function didDequeueAgentPrompt(threadId: string, sessionId: string, id: string): boolean {
  return runnersFor(sessionId).some((runner) => runner.controls.dequeue(threadId, id));
}
