import { GraphRecursionError, MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { HumanMessage, BaseMessage } from "@langchain/core/messages";
import { createAgentTools } from "../tools";
import { logConversation } from "../telemetry/logger";
import { generateSessionId } from "../telemetry/session";
import {
  persistCompletedTurn,
  didPersistFailedTurn,
  closeToolCallsAfterFailure,
} from "./turnPersistence";
import type {
  AgentRunnerOptions,
  RunOptions,
  TurnRecord,
  TurnResult,
  WorkflowModelFactory,
} from "./runnerTypes";
import { findApiKey } from "../../common/env";
import { createLogger } from "../log";
import type { Runtime } from "../ports";
import type { UserPromptValue } from "../../types";
import type { ExecutionModeSource } from "../tools/approval";
import type { AgentInterceptor, PipelineContext } from "./types";
import { extractFinalResponse } from "./thinking";
import { createCompiledWorkflow, workerConversation, type CompiledWorkflow } from "./workflow";
import { createGeminiModel } from "./geminiModel";
import { closeUnansweredToolCalls, messageCount, rehydrateHistory } from "./threadState";
import type { ContextFile, RecoverableCall, TurnEvent, TurnEventListener } from "../turn/events";
import { PromptBroker } from "./promptBroker";
import { emitToolResults, recoverToolCalls } from "./recovery";
import { SessionWriter } from "./sessionWriter";

export type * from "./runnerTypes";
import { countRetries, createTurnEventLog } from "../turn/eventLog";
import { GRAPH_RECURSION_LIMIT } from "./limits";

const log = createLogger("pipeline/runner");

const STEP_LIMIT_MESSAGE = `Stopped after reaching the ${GRAPH_RECURSION_LIMIT}-step limit. Send "continue" to keep going.`;

function isSameToolSet(a: string[] | undefined, b: string[]): boolean {
  return !!a && a.length === b.length && a.every((name) => b.includes(name));
}

export class AgentRunner {
  private activeControllers = new Map<string, AbortController>();
  private checkpointer = new MemorySaver();
  private modelName: string;
  private createModel: WorkflowModelFactory;
  private runtime: Runtime;
  private prompts = new PromptBroker();
  private writer: SessionWriter;
  public workspaceDir: string;
  public interceptors: AgentInterceptor[];
  public sessionId: string;
  public systemPrompt: string;
  public contextFiles: ContextFile[];
  public turnIndex: number;
  public enabledTools?: string[];
  public thinkingBudget?: number;
  public executionMode: ExecutionModeSource;
  public compiled!: CompiledWorkflow;

  constructor(options: AgentRunnerOptions) {
    this.runtime = options.runtime;
    this.workspaceDir = options.workspaceDir || ".";
    this.modelName = options.modelName ?? "gemini-3.8-flash";
    this.interceptors = options.interceptors ?? [];
    this.sessionId = options.sessionId || generateSessionId(8);
    this.systemPrompt = options.systemPrompt || "You are an expert software engineer...";
    this.contextFiles = options.contextFiles ?? [];
    this.turnIndex = options.initialTurnIndex ?? 1;
    this.enabledTools = options.enabledTools;
    this.thinkingBudget = options.thinkingBudget ?? 1024;
    this.executionMode = options.executionMode ?? "write";
    this.writer = new SessionWriter(this.runtime.fs, () => this.getSessionDir());

    if (options.createModel) {
      this.createModel = options.createModel;
    } else {
      const key = options.apiKey || findApiKey();
      if (!key) throw new Error("Missing Gemini API key for AgentRunner");
      this.createModel = (tools) =>
        createGeminiModel(key, this.modelName, this.thinkingBudget, tools);
    }

    this.initGraph();
  }

  private selectTools() {
    const tools = createAgentTools(this.runtime, this.workspaceDir, this.executionMode, {
      sessionId: this.sessionId,
    });
    return this.enabledTools ? tools.filter((t) => this.enabledTools!.includes(t.name)) : tools;
  }

  private initGraph() {
    const tools = this.selectTools();

    const toolNode = new ToolNode(tools);

    this.compiled = createCompiledWorkflow(
      this.createModel(tools),
      toolNode,
      this.checkpointer,
      this.interceptors,
      this.systemPrompt
    );
  }

  private async runTurn(
    prompt: string | null,
    threadId: string,
    options: RunOptions,
    prepare: (context: PipelineContext) => Promise<void>
  ): Promise<TurnResult> {
    const controller = new AbortController();
    this.activeControllers.set(threadId, controller);
    const onAbort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });

    const turnIndex = this.turnIndex;
    const persisted: TurnEvent[] = [];
    const listeners: TurnEventListener[] = [
      (event) => {
        persisted.push(event);
        this.writer.record(turnIndex, event, persisted);
      },
    ];
    if (options.onEvent) listeners.unshift(options.onEvent);
    const { sink, events } = createTurnEventLog(turnIndex, listeners);
    const context: PipelineContext = {
      workspaceDir: this.workspaceDir,
      threadId,
      sessionId: this.sessionId,
      turnIndex,
      events: sink,
      askUser: this.prompts.createAskUser(sink, controller.signal),
    };
    let startCount = 0;

    sink.emit({ type: "turn_started", threadId, prompt });
    if (this.contextFiles.length > 0)
      sink.emit({
        type: "context_files_loaded",
        agent: "worker",
        hook: "session",
        files: this.contextFiles,
      });
    try {
      await rehydrateHistory(this.compiled, threadId, options.history);
      await prepare(context);
      startCount = await messageCount(this.compiled, threadId);

      const finalResult: { messages: BaseMessage[] } = await this.compiled.invoke(
        prompt === null ? null : { messages: [new HumanMessage(prompt)] },
        {
          configurable: { thread_id: threadId, context },
          signal: controller.signal,
          recursionLimit: GRAPH_RECURSION_LIMIT,
        }
      );
      if (controller.signal.aborted) throw new Error("Generation stopped by user");

      const { response, thinking } = extractFinalResponse(finalResult.messages);
      return await this.completeTurn(finalResult.messages, response, thinking, {
        turnIndex,
        prompt,
        startCount,
        events,
        sink,
      });
    } catch (error) {
      if (error instanceof GraphRecursionError && !controller.signal.aborted) {
        const closed = await closeUnansweredToolCalls(
          this.compiled,
          threadId,
          "Not run: step limit reached"
        );
        emitToolResults(sink, closed);
        log.warn("run:stepLimit", { threadId, turnIndex, closedToolCalls: closed.length });
        const state = await this.compiled.getState({ configurable: { thread_id: threadId } });
        return await this.completeTurn(state.values.messages ?? [], STEP_LIMIT_MESSAGE, "", {
          turnIndex,
          prompt,
          startCount,
          events,
          sink,
        });
      }
      emitToolResults(
        sink,
        await closeToolCallsAfterFailure(this.compiled, threadId, turnIndex, error)
      );
      sink.emit({
        type: "turn_failed",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        aborted: controller.signal.aborted,
      });
      const isSaved = await didPersistFailedTurn(
        this.runtime.fs,
        this.getSessionDir(),
        this.compiled,
        threadId,
        error,
        { turnIndex, prompt, startCount, events }
      );
      if (isSaved) this.turnIndex++;
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      if (this.activeControllers.get(threadId) === controller) {
        this.activeControllers.delete(threadId);
      }
    }
  }

  private async completeTurn(
    messages: BaseMessage[],
    response: string,
    thinking: string,
    turn: TurnRecord
  ): Promise<TurnResult> {
    const { sink, ...record } = turn;
    sink.emit({
      type: "turn_completed",
      retries: countRetries(record.events),
      finalResponse: response,
    });

    const turnDir = await persistCompletedTurn(
      this.runtime.fs,
      this.getSessionDir(),
      messages,
      response,
      thinking,
      record
    );
    this.turnIndex++;
    const logPath = await logConversation(this.runtime.fs, messages, this.workspaceDir);

    return {
      messages,
      events: record.events,
      finalResponse: response,
      turnIndex: record.turnIndex,
      sessionId: this.sessionId,
      turnDir,
      logPath,
    };
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

  public answerPrompt(promptId: string, value: UserPromptValue) {
    this.prompts.answer(promptId, value);
  }

  async run(
    prompt: string,
    threadId: string = `thread-${Date.now()}`,
    options: RunOptions = {}
  ): Promise<TurnResult> {
    return await this.runTurn(prompt, threadId, options, async () => {});
  }

  async recover(
    threadId: string,
    calls: RecoverableCall[],
    options: RunOptions = {}
  ): Promise<TurnResult> {
    return await this.runTurn(null, threadId, options, async (context) => {
      const state = await this.compiled.getState({ configurable: { thread_id: threadId } });
      const results = await recoverToolCalls(calls, {
        tools: this.selectTools(),
        interceptors: this.interceptors,
        conversation: workerConversation(this.systemPrompt, state.values.messages ?? []),
        context,
      });
      await this.compiled.updateState(
        { configurable: { thread_id: threadId } },
        { messages: results },
        "tools"
      );
    });
  }
}
