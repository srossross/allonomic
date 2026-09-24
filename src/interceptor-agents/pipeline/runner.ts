import path from "node:path";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { MessagesAnnotation, StateGraph, START, MemorySaver } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { createAgentTools } from "../../agent/tools";
import { logConversation } from "../../telemetry/logger";
import { generateSessionId, saveTurn } from "../../telemetry/session";
import { findApiKey } from "../../common/env";
import type { ExecutionMode } from "../../types";
import { AgentInterceptor, PipelineContext } from "./types";
import { createInterceptedTools } from "./interceptedTools";
import { extractFinalResponse, sanitizeMessagesForModel } from "./thinking";

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

function createCompiledWorkflow(
  model: ChatGoogleGenerativeAI | ReturnType<ChatGoogleGenerativeAI["bindTools"]>,
  toolNode: ToolNode,
  checkpointer: MemorySaver
) {
  const systemMessage = {
    role: "system",
    content:
      "You are an expert software engineer with access to local tools. Inspect the codebase, read relevant files, and fulfill user requests directly.",
  };

  const callModel = async (state: typeof MessagesAnnotation.State) => {
    const sanitizedMessages = sanitizeMessagesForModel(state.messages);
    const messages = [systemMessage, ...sanitizedMessages];
    const response = await model.invoke(messages);
    return { messages: [response] };
  };

  const afterToolsCondition = (state: typeof MessagesAnnotation.State) => {
    const lastMessage = state.messages.at(-1);
    return lastMessage &&
      typeof lastMessage.content === "string" &&
      lastMessage.content.startsWith("[PENDING_APPROVAL]")
      ? "__end__"
      : "agent";
  };


  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", toolsCondition)
    .addConditionalEdges("tools", afterToolsCondition, ["agent", "__end__"]);

  return workflow.compile({ checkpointer });
}

type CompiledWorkflow = ReturnType<typeof createCompiledWorkflow>;

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
    this.modelName = options.modelName ?? "gemini-2.5-flash";
    this.interceptors = options.interceptors ?? [];
    this.maxExitRetries = options.maxExitRetries ?? 3;
    this.sessionId = options.sessionId || generateSessionId(8);
    this.turnIndex = options.initialTurnIndex ?? 1;
    this.enabledTools = options.enabledTools;
    this.thinkingBudget = options.thinkingBudget ?? 8192;
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

    this.compiled = createCompiledWorkflow(model, toolNode, this.checkpointer);
  }

  public abort(threadId: string): boolean {
    const controller = this.activeControllers.get(threadId);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(threadId);
      return true;
    }
    return false;
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
    if (isChanged) {
      this.initGraph();
    }
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
   * Run the full pipeline for a user prompt with Entry, Pre-Tool, and Exit intercepts.
   * Auto-persists the turn to .atomic/sessions/<sessionId>/turns/<turnIndex>/
   */
  async run(
    prompt: string,
    threadId: string = `thread-${Date.now()}`,
    options?: {
      signal?: AbortSignal;
      history?: Array<{ role: string; content: string }>;
    }
  ) {
    const controller = new AbortController();
    this.activeControllers.set(threadId, controller);

    if (options?.signal) {
      options.signal.addEventListener("abort", () => {
        controller.abort();
      });
    }

    try {
      const context: PipelineContext = {
        workspaceDir: this.workspaceDir,
        threadId,
        sessionId: this.sessionId,
        turnIndex: this.turnIndex,
        entryToolCalls: [],
        preToolLogs: [],
        exitToolCalls: [],
      };

      // 1. ENTRY INTERCEPT
      for (const interceptor of this.interceptors) {
        if (controller.signal.aborted) {
          throw new Error("Generation stopped by user");
        }
        if (interceptor.onUserPrompt) {
          await interceptor.onUserPrompt(prompt, context);
        }
      }

      // Rehydrate past message history into checkpointer if empty
      if (options?.history && options.history.length > 0) {
        const state = await this.compiled.getState({ configurable: { thread_id: threadId } });
        if (!state?.values?.messages || state.values.messages.length === 0) {
          const pastMessages = options.history.map((h) =>
            h.role === "user" || h.role === "human"
              ? new HumanMessage(h.content)
              : new AIMessage(h.content)
          );
          await this.compiled.updateState(
            { configurable: { thread_id: threadId } },
            { messages: pastMessages }
          );
        }
      }

      // 2. WORKER TOOL LOOP + 3. EXIT INTERCEPT RETRIES
      let currentInput: BaseMessage[] = [new HumanMessage(prompt)];
      let retries = 0;
      let finalResult: { messages: BaseMessage[] } = { messages: [] };

      while (retries <= this.maxExitRetries) {
        if (controller.signal.aborted) {
          throw new Error("Generation stopped by user");
        }

        finalResult = await this.compiled.invoke(
          { messages: currentInput },
          { configurable: { thread_id: threadId }, signal: controller.signal }
        );

        if (controller.signal.aborted) {
          throw new Error("Generation stopped by user");
        }

        // Check Exit Interceptors
        let isNeedsRetry = false;
        let combinedFeedback = "";

        for (const interceptor of this.interceptors) {
          if (!interceptor.onAgentFinish) {
            continue;
          }

          const verdict = await interceptor.onAgentFinish(finalResult.messages, context);
          if (verdict.allowFinish) {
            continue;
          }

          isNeedsRetry = true;
          combinedFeedback += `\n[${interceptor.name} Feedback]: ${verdict.feedback}`;
        }

        if (!isNeedsRetry) {
          break; // Passed all exit intercepts!
        }

        retries++;
        if (retries > this.maxExitRetries) {
          console.warn(`[AgentRunner] Hit max exit retries (${this.maxExitRetries}). Returning.`);
          break;
        }

        // Reinject feedback into the worker loop
        currentInput = [
          new HumanMessage(
            `Your output did not satisfy the exit criteria:${combinedFeedback}\nPlease address this feedback to complete the task.`
          ),
        ];
      }

      // Extract assistant final text and reasoning / thinking
      const { response: finalAgentResponse, thinking } = extractFinalResponse(finalResult.messages);

      // Save persistent turn directory: .atomic/sessions/<sessionId>/turns/<turnIndex>/
      const sessionDir = path.resolve(this.workspaceDir, ".atomic/sessions", this.sessionId);
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

      return {
        result: finalResult,
        thinking,
        logPath,
        turnDir,
        sessionId: this.sessionId,
        turnIndex: currentTurn,
        retries,
        pipelineContext: context,
      };
    } finally {
      this.activeControllers.delete(threadId);
    }
  }
}
