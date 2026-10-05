import { GraphRecursionError, MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { BaseMessage } from "@langchain/core/messages";
import { turnPromptMessage } from "./userPrompt";
import { createAgentTools } from "../tools";
import { createToolOutputStore } from "../tools/toolOutputCap";
import { logConversation } from "../telemetry/logger";
import { generateSessionId } from "../telemetry/session";
import { failTurn } from "./turnPersistence";
import { turnDirFor } from "../turn/turnFiles";
import { loadWorkerMessages } from "../session/rehydration";
import type {
  AgentRunnerOptions,
  RunOptions,
  TurnRecord,
  TurnResult,
  WorkflowModelFactory,
} from "./runnerTypes";
import { findApiKey } from "../../common/env";
import { createLogger, registerSessionSink, type Logger } from "../log";
import type { Runtime } from "../ports";
import type { UserPromptValue } from "../../types";
import { DEFAULT_MODEL_ID } from "../../types/chat";
import type { ExecutionModeSource } from "../tools/approval";
import type { AgentInterceptor, PipelineContext } from "./types";
import { extractFinalResponse } from "./thinking";
import { createCompiledWorkflow, workerConversation, type CompiledWorkflow } from "./workflow";
import { createGeminiModel } from "./geminiModel";
import { closeUnansweredToolCalls, messageCount, rehydrateHistory } from "./threadState";
import type { ContextFile, RecoverableCall, TurnEventListener } from "../turn/events";
import { SettingsRecorder } from "./settingsRecorder";
import { beginTurn } from "./turnStart";
import { PromptBroker } from "./promptBroker";
import { emitToolResults, recoverToolCalls } from "./recovery";
import { SessionWriter } from "./sessionWriter";
import { WarningRelay } from "./warningRelay";
import { StopError } from "./stopError";
import { TurnControls } from "./turnControl";
import { createSessionProcesses, type SessionProcesses } from "../jobs/sessionProcesses";

export type * from "./runnerTypes";
import { countRetries, createTurnEventLog } from "../turn/eventLog";
import { GRAPH_RECURSION_LIMIT } from "./limits";

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
  private log: Logger;
  private warnings = new WarningRelay();
  private loadHistory: (beforeTurn: number) => Promise<BaseMessage[]>;
  private settings: SettingsRecorder;
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
  public controls = new TurnControls();
  public processes: SessionProcesses;

  constructor(options: AgentRunnerOptions) {
    this.runtime = options.runtime;
    this.workspaceDir = options.workspaceDir || ".";
    this.modelName = options.modelName ?? DEFAULT_MODEL_ID;
    this.interceptors = options.interceptors ?? [];
    this.sessionId = options.sessionId || generateSessionId();
    this.systemPrompt = options.systemPrompt || "You are an expert software engineer...";
    this.contextFiles = options.contextFiles ?? [];
    this.turnIndex = options.initialTurnIndex ?? 1;
    this.enabledTools = options.enabledTools;
    this.thinkingBudget = options.thinkingBudget ?? 1024;
    this.executionMode = options.executionMode ?? "write";
    this.loadHistory =
      options.loadHistory ??
      ((beforeTurn) => loadWorkerMessages(this.runtime.fs, this.getSessionDir(), beforeTurn));
    this.log = createLogger("pipeline/runner").child({ sessionId: this.sessionId });
    this.settings = new SettingsRecorder(this.runtime, this.workspaceDir, this.sessionId);
    this.writer = new SessionWriter(
      this.runtime.fs,
      () => this.getSessionDir(),
      this.warnings.warn
    );
    const startupWarnings = options.startupWarnings ?? [];
    for (const { source, error } of startupWarnings) this.warnings.warn(source, error);
    registerSessionSink(this.sessionId, (record) => this.writer.appendLog(record));
    this.processes = createSessionProcesses(this.runtime, this);

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
      ...this.processes,
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
      this.systemPrompt,
      this.modelName
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
    const listeners: TurnEventListener[] = options.onEvent ? [options.onEvent] : [];
    const { sink, events, closeOpenScopes } = createTurnEventLog(turnIndex, listeners, (segment) =>
      this.writer.commit(turnIndex, segment)
    );
    const context: PipelineContext = {
      workspaceDir: this.workspaceDir,
      threadId,
      sessionId: this.sessionId,
      turnIndex,
      events: sink,
      askUser: this.prompts.createAskUser(sink, controller.signal),
      control: this.controls.start(threadId),
      recordSettings: this.settings.inUserScope(sink),
      storeToolOutput: createToolOutputStore(this.runtime, this.workspaceDir, this.sessionId),
    };
    let startCount = 0;
    const turnRecord = () => ({ turnIndex, prompt, startCount, events, sink, closeOpenScopes });

    try {
      await beginTurn(sink, this.settings, { threadId, prompt, contextFiles: this.contextFiles });
      this.warnings.attach(sink);
      await rehydrateHistory(this.compiled, threadId, () => this.loadHistory(turnIndex), this.log);
      await prepare(context);
      startCount = await messageCount(this.compiled, threadId);

      const finalResult: { messages: BaseMessage[] } = await this.compiled.invoke(
        prompt === null ? null : { messages: [turnPromptMessage(prompt)] },
        {
          configurable: { thread_id: threadId, context },
          signal: controller.signal,
          recursionLimit: GRAPH_RECURSION_LIMIT,
        }
      );
      if (controller.signal.aborted) throw new StopError();

      const { response } = extractFinalResponse(finalResult.messages, startCount);
      return await this.completeTurn(finalResult.messages, response, turnRecord());
    } catch (error) {
      if (error instanceof GraphRecursionError && !controller.signal.aborted) {
        const closed = await closeUnansweredToolCalls(
          this.compiled,
          threadId,
          "Not run: step limit reached"
        );
        emitToolResults(sink, closed);
        this.log.warn({ threadId, turnIndex, closedToolCalls: closed.length }, "run:stepLimit");
        const state = await this.compiled.getState({ configurable: { thread_id: threadId } });
        const messages = state.values.messages ?? [];
        return await this.completeTurn(messages, STEP_LIMIT_MESSAGE, turnRecord());
      }
      closeOpenScopes();
      const { failure, isSaved } = await failTurn(error, {
        log: this.log,
        flush: () => this.writer.flush(),
        compiled: this.compiled,
        threadId,
        sink,
        aborted: controller.signal.aborted,
        record: { turnIndex, prompt, startCount, events },
      });
      if (isSaved) this.turnIndex++;
      throw failure;
    } finally {
      this.warnings.detach(sink);
      options.signal?.removeEventListener("abort", onAbort);
      if (this.activeControllers.get(threadId) === controller) {
        this.activeControllers.delete(threadId);
      }
      this.controls.end(threadId, context.control);
    }
  }

  private async completeTurn(
    messages: BaseMessage[],
    response: string,
    turn: TurnRecord
  ): Promise<TurnResult> {
    const { sink, closeOpenScopes, ...record } = turn;
    closeOpenScopes();
    await this.writer.flush();
    sink.emit({
      type: "turn_completed",
      retries: countRetries(record.events),
      finalResponse: response,
    });
    await this.writer.flush();
    this.turnIndex++;
    let logPath: string | undefined;
    try {
      logPath = await logConversation(this.runtime.fs, messages, this.workspaceDir);
    } catch (error) {
      this.warnings.warn("conversation log", error);
    }

    return {
      messages,
      events: record.events,
      finalResponse: response,
      turnIndex: record.turnIndex,
      sessionId: this.sessionId,
      turnDir: turnDirFor(this.getSessionDir(), record.turnIndex),
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

  public async resetThread(rewind: () => Promise<number>) {
    if (this.activeControllers.size > 0) throw new Error("Cannot rewind while a turn is running");
    this.turnIndex = await rewind();
    this.checkpointer = new MemorySaver();
    this.initGraph();
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
