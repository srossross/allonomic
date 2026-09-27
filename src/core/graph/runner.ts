import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { HumanMessage, BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { createAgentTools } from "../tools";
import { logConversation } from "../telemetry/logger";
import { generateSessionId, saveTurn, appendTraceLog, saveTurnError } from "../telemetry/session";
import { findApiKey } from "../../common/env";
import { createLogger } from "../log";
import type { HistoryEntry } from "../history";
import type { Runtime } from "../ports";
import type { ExecutionMode, UserPromptValue } from "../../types";
import { AgentInterceptor, PipelineContext } from "./types";
import { extractFinalResponse, thinkingConfigFor } from "./thinking";
import { createCompiledWorkflow, type CompiledWorkflow } from "./workflow";
import { messageCount, rehydrateHistory, respondToPromptResult } from "./threadState";
import type { TurnEvent, TurnEventListener, TurnEventSink } from "../turn/events";
import { countRetries, createTurnEventLog } from "../turn/eventLog";
import { formatTraceLine } from "../turn/trace";

const log = createLogger("pipeline/runner");

export interface AgentRunnerOptions {
  runtime: Runtime;
  workspaceDir?: string;
  modelName?: string;
  apiKey?: string;
  interceptors?: AgentInterceptor[];
  systemPrompt?: string;
  sessionId?: string;
  initialTurnIndex?: number;
  enabledTools?: string[];
  thinkingBudget?: number;
  executionMode?: ExecutionMode;
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
  logPath: string;
}

function isSameToolSet(a: string[] | undefined, b: string[]): boolean {
  return !!a && a.length === b.length && a.every((name) => b.includes(name));
}

export class AgentRunner {
  private activeControllers = new Map<string, AbortController>();
  private checkpointer = new MemorySaver();
  private modelName: string;
  private apiKey: string;
  private runtime: Runtime;
  private approvedTools: StructuredToolInterface[] = [];
  private traceQueue: Promise<void> = Promise.resolve();
  public workspaceDir: string;
  public interceptors: AgentInterceptor[];
  public sessionId: string;
  public systemPrompt: string;
  public turnIndex: number;
  public enabledTools?: string[];
  public thinkingBudget?: number;
  public executionMode: ExecutionMode;
  public compiled!: CompiledWorkflow;

  constructor(options: AgentRunnerOptions) {
    this.runtime = options.runtime;
    this.workspaceDir = options.workspaceDir || ".";
    this.modelName = options.modelName ?? "gemini-3.8-flash";
    this.interceptors = options.interceptors ?? [];
    this.sessionId = options.sessionId || generateSessionId(8);
    this.systemPrompt = options.systemPrompt || "You are an expert software engineer...";
    this.turnIndex = options.initialTurnIndex ?? 1;
    this.enabledTools = options.enabledTools;
    this.thinkingBudget = options.thinkingBudget ?? 1024;
    this.executionMode = options.executionMode ?? "accept edits";

    const key = options.apiKey || findApiKey();
    if (!key) throw new Error("Missing Gemini API key for AgentRunner");
    this.apiKey = key;

    this.initGraph();
  }

  private selectTools<T extends { name: string }>(tools: T[]): T[] {
    return this.enabledTools ? tools.filter((t) => this.enabledTools!.includes(t.name)) : tools;
  }

  private initGraph() {
    const tools = this.selectTools(
      createAgentTools(this.runtime, this.workspaceDir, this.executionMode)
    );
    this.approvedTools = this.selectTools(
      createAgentTools(this.runtime, this.workspaceDir, this.executionMode, { approved: true })
    );

    const toolNode = new ToolNode(tools);

    const thinkingConfig = thinkingConfigFor(this.thinkingBudget);
    const baseModel = new ChatGoogleGenerativeAI({
      model: this.modelName,
      apiKey: this.apiKey,
      temperature: 0.2,
      ...(thinkingConfig && { thinkingConfig }),
    });
    const model = tools.length > 0 ? baseModel.bindTools(tools) : baseModel;

    this.compiled = createCompiledWorkflow(
      model,
      toolNode,
      this.checkpointer,
      this.interceptors,
      this.systemPrompt
    );
  }

  private traceEvent(event: TurnEvent) {
    const previous = this.traceQueue;
    const line = formatTraceLine(event);
    this.traceQueue = (async () => {
      await previous;
      await appendTraceLog(this.runtime.fs, this.getSessionDir(), line);
    })();
  }

  private async invokeToolApproved(name: string, args: Record<string, unknown>): Promise<string> {
    const t = this.approvedTools.find((x) => x.name === name);
    if (!t) return `Error: tool ${name} is not available`;
    try {
      const r = await t.invoke(args);
      return typeof r === "string" ? r : JSON.stringify(r);
    } catch (error: unknown) {
      return `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async runTurn(
    prompt: string | null,
    threadId: string,
    options: RunOptions,
    prepare: (sink: TurnEventSink) => Promise<void>
  ): Promise<TurnResult> {
    const controller = new AbortController();
    this.activeControllers.set(threadId, controller);
    options.signal?.addEventListener("abort", () => controller.abort());

    const turnIndex = this.turnIndex;
    const sessionDir = this.getSessionDir();
    const listeners: TurnEventListener[] = [(event) => this.traceEvent(event)];
    if (options.onEvent) listeners.unshift(options.onEvent);
    const { sink, events } = createTurnEventLog(turnIndex, listeners);
    const context: PipelineContext = {
      workspaceDir: this.workspaceDir,
      threadId,
      sessionId: this.sessionId,
      turnIndex,
      events: sink,
    };
    let startCount = 0;

    sink.emit({ type: "turn_started", threadId, prompt });
    try {
      await rehydrateHistory(this.compiled, threadId, options.history);
      await prepare(sink);
      startCount = await messageCount(this.compiled, threadId);

      const finalResult: { messages: BaseMessage[] } = await this.compiled.invoke(
        prompt === null ? null : { messages: [new HumanMessage(prompt)] },
        {
          configurable: { thread_id: threadId, context },
          signal: controller.signal,
          recursionLimit: 50,
        }
      );
      if (controller.signal.aborted) throw new Error("Generation stopped by user");

      const { response, thinking } = extractFinalResponse(finalResult.messages);
      const turnMessages = finalResult.messages.slice(startCount);
      sink.emit({ type: "turn_completed", retries: countRetries(events), finalResponse: response });

      const turnDir = await saveTurn(this.runtime.fs, sessionDir, {
        turnIndex,
        userPrompt: prompt ?? "",
        agentResponse: response,
        thinking: thinking || undefined,
        agentMessages: turnMessages,
        events,
      });
      this.turnIndex++;
      const logPath = await logConversation(
        this.runtime.fs,
        finalResult.messages,
        this.workspaceDir
      );

      return {
        messages: finalResult.messages,
        events,
        finalResponse: response,
        turnIndex,
        sessionId: this.sessionId,
        turnDir,
        logPath,
      };
    } catch (error) {
      sink.emit({
        type: "turn_failed",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        aborted: controller.signal.aborted,
      });
      await this.persistFailure(threadId, turnIndex, prompt, error, startCount, events);
      throw error;
    } finally {
      this.activeControllers.delete(threadId);
    }
  }

  private async persistFailure(
    threadId: string,
    turnIndex: number,
    prompt: string | null,
    error: unknown,
    startCount: number,
    events: TurnEvent[]
  ) {
    try {
      const failedState = await this.compiled.getState({ configurable: { thread_id: threadId } });
      const allMessages: BaseMessage[] = failedState?.values?.messages ?? [];
      log.error("run:failed", {
        threadId,
        turnIndex,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        messageCount: allMessages.length,
        next: failedState?.next,
      });
      await saveTurnError(this.runtime.fs, this.getSessionDir(), {
        turnIndex,
        userPrompt: prompt ?? "",
        error,
        agentMessages: allMessages.slice(startCount),
        events,
      });
      this.turnIndex++;
    } catch (saveError) {
      console.warn("[AgentRunner] Failed to persist turn error:", saveError);
    }
  }

  public getSessionDir(): string {
    return `${this.workspaceDir}/.allonomic/sessions/${this.sessionId}`;
  }

  public abort(threadId: string): boolean {
    const controller = this.activeControllers.get(threadId);
    if (!controller) return false;
    controller.abort();
    this.activeControllers.delete(threadId);
    return true;
  }

  public setModelAndThinking(modelName?: string, thinkingBudget?: number) {
    let isChanged = false;
    if (modelName && modelName !== this.modelName) {
      this.modelName = modelName;
      isChanged = true;
    }
    if (thinkingBudget !== undefined && thinkingBudget !== this.thinkingBudget) {
      this.thinkingBudget = thinkingBudget;
      isChanged = true;
    }
    if (isChanged) this.initGraph();
  }

  public setEnabledTools(tools: string[]) {
    if (isSameToolSet(this.enabledTools, tools)) return;
    this.enabledTools = tools;
    this.initGraph();
  }

  public setExecutionMode(mode?: ExecutionMode) {
    if (!mode || mode === this.executionMode) return;
    this.executionMode = mode;
    this.initGraph();
  }

  async run(
    prompt: string,
    threadId: string = `thread-${Date.now()}`,
    options: RunOptions = {}
  ): Promise<TurnResult> {
    return await this.runTurn(prompt, threadId, options, async () => {});
  }

  async resume(
    threadId: string,
    toolId: string,
    value: UserPromptValue,
    options: RunOptions = {}
  ): Promise<TurnResult> {
    return await this.runTurn(null, threadId, options, async (sink) => {
      const patched = await respondToPromptResult(this.compiled, threadId, toolId, value, (n, a) =>
        this.invokeToolApproved(n, a)
      );
      if (!patched) throw new Error(`No pending prompt for tool call ${toolId}`);
      sink.emit({
        type: "tool_result",
        toolCallId: patched.toolCallId,
        name: patched.name,
        content: patched.result,
      });
    });
  }
}
