import path from "node:path";
import * as fs from "node:fs";
import { AgentRunner } from "../interceptor-agents/pipeline/runner";
import { GovernorInterceptor } from "../interceptor-agents/governor/interceptor";
import {
  extractAssistantText,
  extractContextMessages,
  extractTurnToolCalls,
  buildTurnEvents,
} from "./turnEvents";
import { loadSessionMetadata, saveSessionMetadata } from "../persistence/sessionMetadata";
import type { SessionMetadata } from "../types/persistence";
import type { ExecutionMode } from "../types";

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

export function getAgentInstance(
  workspaceDir?: string,
  sessionId?: string,
  initialTurnIndex?: number
): AgentInstance {
  const defaultWorkspace = path.resolve(process.cwd(), "../toy-test-01");
  const effectiveWorkspace = workspaceDir
    ? path.resolve(workspaceDir)
    : fs.existsSync(defaultWorkspace)
      ? defaultWorkspace
      : process.cwd();

  const effectiveSessionId = sessionId || "default-session";
  const key = getSessionKey(effectiveWorkspace, effectiveSessionId);

  const existing = runnersMap.get(key);
  if (existing) {
    return existing;
  }

  // Check if session directory already has turns on disk to set initialTurnIndex
  let startingTurn = initialTurnIndex;
  if (startingTurn === undefined) {
    try {
      const turnsDir = path.join(effectiveWorkspace, ".atomic/sessions", effectiveSessionId, "turns");
      if (fs.existsSync(turnsDir)) {
        const entries = fs.readdirSync(turnsDir).filter((e) => /^\d+$/.test(e));
        startingTurn = entries.length + 1;
      }
    } catch {
      // Fallback
    }
  }

  const governor = new GovernorInterceptor();
  const runner = new AgentRunner({
    workspaceDir: effectiveWorkspace,
    sessionId: effectiveSessionId,
    initialTurnIndex: startingTurn ?? 1,
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

export interface RunAgentPromptOptions {
  prompt: string;
  threadId?: string;
  sessionId?: string;
  workspaceDir?: string;
  enabledTools?: string[];
  modelName?: string;
  thinkingBudget?: number;
  executionMode?: ExecutionMode;
  history?: Array<{ role: string; content: string }>;
}

export async function runAgentPrompt(
  promptOrOptions: string | RunAgentPromptOptions,
  threadId?: string,
  enabledTools?: string[],
  modelName?: string,
  thinkingBudget?: number
) {
  const options: RunAgentPromptOptions =
    typeof promptOrOptions === "string"
      ? {
          prompt: promptOrOptions,
          threadId,
          sessionId: threadId,
          enabledTools,
          modelName,
          thinkingBudget,
        }
      : promptOrOptions;

  const {
    prompt,
    workspaceDir,
    enabledTools: tools,
    modelName: model = "gemini-2.5-flash",
    thinkingBudget: budget,
    executionMode,
    history,
  } = options;

  const effectiveThreadId = options.threadId || options.sessionId || `thread-${Date.now()}`;
  const effectiveSessionId = options.sessionId || options.threadId || `session-${Date.now()}`;

  const startTime = Date.now();
  const { runner, governor, workspaceDir: effectiveWorkspace } = getAgentInstance(
    workspaceDir,
    effectiveSessionId
  );

  if (executionMode) {
    runner.setExecutionMode(executionMode);
  }

  if (tools && Array.isArray(tools)) {
    runner.setEnabledTools(tools);
  }
  const effectiveThinkingBudget = budget === undefined ? 8192 : budget;
  runner.setModelAndThinking(model, effectiveThinkingBudget);

  const { result, thinking, retries, turnIndex, pipelineContext } = await runner.run(
    prompt,
    effectiveThreadId,
    { history }
  );
  const thinkingDurationSeconds = Math.max(1, Math.round((Date.now() - startTime) / 1000));

  const messages = result.messages || [];
  const assistantText = extractAssistantText(messages);
  const contextMessages = extractContextMessages(messages);
  const turnToolCalls = extractTurnToolCalls(messages);

  const turnEvents = buildTurnEvents({
    prompt,
    threadId: effectiveThreadId,
    governorName: governor.name || "Governor",
    messages,
    pipelineContext,
    thinking,
    retries,
    turnIndex,
  });

  // Update session metadata on disk
  try {
    const existingMeta = await loadSessionMetadata(effectiveWorkspace, effectiveSessionId);
    const updatedMeta: SessionMetadata = {
      sessionId: effectiveSessionId,
      title: existingMeta?.title || prompt.slice(0, 30) || "Chat",
      closed: existingMeta?.closed ?? false,
      createdAt: existingMeta?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model,
      thinkingLevel: existingMeta?.thinkingLevel || "High",
      enabledTools: tools || existingMeta?.enabledTools,
      turnCount: turnIndex,
      lastPrompt: prompt,
    };
    await saveSessionMetadata(effectiveWorkspace, updatedMeta);
  } catch (error) {
    console.warn(`[AgentServer] Failed to save session metadata:`, error);
  }

  return {
    assistantMessage:
      assistantText ||
      (turnToolCalls.some((t) => t.status === "pending") ? "" : "Task processed."),
    thinking: thinking || undefined,
    thinkingDurationSeconds: thinking ? thinkingDurationSeconds : undefined,
    toolCalls: turnToolCalls.length > 0 ? turnToolCalls : undefined,
    governorState: governor.state,
    contextMessages,
    turnEvents,
  };
}

export function stopAgentPrompt(threadId: string, sessionId?: string) {
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

export function getGovernorState(workspaceDir?: string, sessionId?: string) {
  const { governor } = getAgentInstance(workspaceDir, sessionId);
  return governor.state;
}

export function getInstalledInjectors(workspaceDir?: string, sessionId?: string) {
  const { governor } = getAgentInstance(workspaceDir, sessionId);
  return [
    {
      id: "governor",
      name: governor.name || "Governor",
      type: "Pipeline Interceptor",
      status: "active",
      modelName: "gemini-2.5-flash",
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
