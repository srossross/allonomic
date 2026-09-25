import path from "node:path";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { HumanMessage, BaseMessage } from "@langchain/core/messages";
import { createAgentTools } from "../../agent/tools";
import { logConversation } from "../../telemetry/logger";
import { generateSessionId, saveTurn, appendTraceLog, saveTurnError } from "../../telemetry/session";
import { findApiKey } from "../../common/env";
import type { ExecutionMode } from "../../types";
import { AgentInterceptor, PipelineContext } from "./types";
import { createInterceptedTools } from "./interceptedTools";
import { extractFinalResponse } from "./thinking";
import {
  createCompiledWorkflow,
  rehydrateHistory,
  type CompiledWorkflow,
} from "./workflow";

export interface AgentRunnerOptions {
  workspaceDir?: string;
  modelName?: string;
  apiKey?: string;
  interceptors?: AgentInterceptor[];
  maxExitRetries?: number;
  sessionId?: string;
  initialTurnIndex?: number;
  enabledTools?: string[];
  thinkingBudget?: number;
  executionMode?: ExecutionMode;
}

export class AgentRunner {
  private activeControllers = new Map<string, AbortController>();
  private checkpointer = new MemorySaver();
  private modelName: string;
  private apiKey: string;
  private maxExitRetries: number;
  public workspaceDir: string;
  public interceptors: AgentInterceptor[];
  public sessionId: string;
  public turnIndex: number;
  public enabledTools?: string[];
  public thinkingBudget?: number;
  public executionMode: ExecutionMode;
  public compiled!: CompiledWorkflow;

  constructor(options: AgentRunnerOptions = {}) {
    this.workspaceDir = options.workspaceDir || process.cwd();
    this.modelName = options.modelName ?? "gemini-3.8-flash";
    this.interceptors = options.interceptors ?? [];
    this.maxExitRetries = options.maxExitRetries ?? 3;
    this.sessionId = options.sessionId || generateSessionId(8);
    this.turnIndex = options.initialTurnIndex ?? 1;
    this.enabledTools = options.enabledTools;
    this.thinkingBudget = options.thinkingBudget ?? 1024;
    this.executionMode = options.executionMode ?? "accept edits";

    const key = options.apiKey || findApiKey();
    if (!key) throw new Error("Missing Gemini API key for AgentRunner");
    this.apiKey = key;

    this.initGraph();
  }

  private initGraph() {
    const allTools = createAgentTools(this.workspaceDir, this.executionMode);
    const rawTools = this.enabledTools
      ? allTools.filter((t) => this.enabledTools!.includes(t.name))
      : allTools;

    // Wrap each tool with the Pre-Tool Interceptor pipeline
    const interceptedTools = createInterceptedTools({
      tools: rawTools,
      interceptors: this.interceptors,
      workspaceDir: this.workspaceDir,
      sessionId: this.sessionId,
      turnIndex: this.turnIndex,
    });

    const toolNode = new ToolNode(interceptedTools);

    const thinkingConfig =
      this.thinkingBudget !== undefined && this.thinkingBudget > 0
        ? { includeThoughts: true, thinkingBudget: this.thinkingBudget }
        : this.thinkingBudget === 0
          ? { thinkingBudget: 0 }
          : undefined;

    const baseModel = new ChatGoogleGenerativeAI({
      model: this.modelName,
      apiKey: this.apiKey,
      temperature: 0.2,
      ...(thinkingConfig && { thinkingConfig }),
    });
    const model = interceptedTools.length > 0 ? baseModel.bindTools(interceptedTools) : baseModel;

    this.compiled = createCompiledWorkflow(
      model,
      toolNode,
      this.checkpointer,
      this.interceptors,
      (msg) => this.trace(msg)
    );
  }

  public getSessionDir(): string {
    return path.resolve(this.workspaceDir, ".atomic/sessions", this.sessionId);
  }

  public trace(message: string) {
    const dir = this.getSessionDir();
    void appendTraceLog(dir, message);
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
    this.enabledTools = tools;
    this.initGraph();
  }

  public setExecutionMode(mode?: ExecutionMode) {
    if (!mode || mode === this.executionMode) return;
    this.executionMode = mode;
    this.initGraph();
  }

  /**
   * Resume an interrupted tool call by injecting the result and continuing the loop.
   */
  public async resumeTool(threadId: string, toolId: string, resultString: string) {
    const state = await this.compiled.getState({ configurable: { thread_id: threadId } });
    if (!state || !state.values || !state.values.messages) return null;

    const messages = state.values.messages;
    const index = messages.findIndex((m: BaseMessage) => m._getType() === "tool" && (m.name === toolId || Reflect.get(m, "tool_call_id") === toolId));
    
    if (index === -1) return null;

    const oldMessage = messages[index];
    const newToolMessage = new ToolMessage({
      content: resultString,
      name: oldMessage.name,
      tool_call_id: String(Reflect.get(oldMessage, "tool_call_id")),
    });
    newToolMessage.id = oldMessage.id;

    await this.compiled.updateState(
      { configurable: { thread_id: threadId } },
      { messages: [newToolMessage] },
      "tools"
    );
  }

  /**
   * Run the full pipeline for a user prompt natively using LangGraph.
   */
  async run(
    prompt: string | null,
    threadId: string = `thread-${Date.now()}`,
    options?: {
      signal?: AbortSignal;
      history?: Array<{ role: string; content: string }>;
    }
  ) {
    const controller = new AbortController();
    this.activeControllers.set(threadId, controller);

    if (options?.signal) {
      options.signal.addEventListener("abort", () => controller.abort());
    }

    const sessionDir = this.getSessionDir();
    const context: PipelineContext = {
      workspaceDir: this.workspaceDir,
      threadId,
      sessionId: this.sessionId,
      turnIndex: this.turnIndex,
      entryToolCalls: [],
      preToolLogs: [],
      exitToolCalls: [],
    };

    if (prompt === null) {
      this.trace(`[TURN_RESUME] Turn ${this.turnIndex}: Resuming execution...`);
    } else {
      this.trace(`[TURN_START] Turn ${this.turnIndex}: prompt="${prompt.slice(0, 100)}"`);
    }

    try {
      // Rehydrate past message history into checkpointer if empty
      await rehydrateHistory(this.compiled, threadId, options?.history);

      const currentInput: BaseMessage[] | null = prompt === null ? null : [new HumanMessage(prompt)];
      let finalResult: { messages: BaseMessage[] } = { messages: [] };

      finalResult = await this.compiled.invoke(
        currentInput ? { messages: currentInput } : null,
        {
          configurable: { thread_id: threadId, context },
          signal: controller.signal,
          recursionLimit: 50,
        }
      );

      if (controller.signal.aborted) {
        throw new Error("Generation stopped by user");
      }

      // Extract assistant final text and reasoning / thinking
      const { response: finalAgentResponse, thinking } = extractFinalResponse(finalResult.messages);

      // Save persistent turn directory: .atomic/sessions/<sessionId>/turns/<turnIndex>/
      const turnDir = await saveTurn(sessionDir, {
        turnIndex: this.turnIndex,
        userPrompt: prompt,
        agentResponse: finalAgentResponse,
        thinking: thinking || undefined,
        agentMessages: finalResult.messages,
        entryToolCalls: context.entryToolCalls,
        preToolLogs: context.preToolLogs,
        exitToolCalls: context.exitToolCalls,
      });

      const currentTurn = this.turnIndex;
      this.turnIndex++;

      // Also auto-log to legacy .atomic/conversation-<pid>.yml for backwards compat
      const logPath = await logConversation(finalResult.messages, this.workspaceDir);
      this.trace(`[TURN_SUCCESS] Turn ${currentTurn} finished successfully.`);

      return {
        result: finalResult,
        thinking,
        logPath,
        turnDir,
        sessionId: this.sessionId,
        turnIndex: currentTurn,
        retries: 0,
        pipelineContext: context,
      };
    } catch (error) {
      this.trace(
        `[TURN_ERROR] Turn ${this.turnIndex} failed: ${error instanceof Error ? error.message : String(error)}`
      );
      try {
        await saveTurnError(sessionDir, {
          turnIndex: this.turnIndex,
          userPrompt: prompt,
          error,
          entryToolCalls: context.entryToolCalls,
          preToolLogs: context.preToolLogs,
          exitToolCalls: context.exitToolCalls,
        });
      } catch (saveError) {
        console.warn("[AgentRunner] Failed to persist turn error:", saveError);
      }
      throw error;
    } finally {
      this.activeControllers.delete(threadId);
    }
  }
}
