import type { BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { WorkflowModel } from "./workflow";
import type { HistoryEntry } from "../history";
import type { Runtime } from "../ports";
import type { ExecutionModeSource } from "../tools/approval";
import type { ContextFile, TurnEvent, TurnEventListener, TurnEventSink } from "../turn/events";
import type { AgentInterceptor } from "./types";
import type { TurnRecord as PersistedTurnRecord } from "./turnPersistence";

export type WorkflowModelFactory = (tools: StructuredToolInterface[]) => WorkflowModel;

export interface AgentRunnerOptions {
  runtime: Runtime;
  createModel?: WorkflowModelFactory;
  workspaceDir?: string;
  modelName?: string;
  apiKey?: string;
  interceptors?: AgentInterceptor[];
  systemPrompt?: string;
  contextFiles?: ContextFile[];
  sessionId?: string;
  initialTurnIndex?: number;
  enabledTools?: string[];
  thinkingBudget?: number;
  executionMode?: ExecutionModeSource;
  startupWarnings?: { source: string; error: unknown }[];
}

export interface RunOptions {
  signal?: AbortSignal;
  history?: HistoryEntry[];
  onEvent?: TurnEventListener;
}

export interface TurnResult {
  messages: BaseMessage[];
  events: TurnEvent[];
  finalResponse: string;
  turnIndex: number;
  sessionId: string;
  turnDir: string;
  logPath?: string;
}

export type TurnRecord = PersistedTurnRecord & { sink: TurnEventSink };
