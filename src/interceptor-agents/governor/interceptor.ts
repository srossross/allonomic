import * as fs from "node:fs";
import path from "node:path";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SystemMessage, HumanMessage, BaseMessage, ToolMessage } from "@langchain/core/messages";
import { findApiKey } from "../../common/env";
import {
  AgentInterceptor,
  ToolCall,
  ToolApproval,
  ExitVerdict,
  PipelineContext,
} from "../pipeline/types";
import { GovernorState } from "./types";
import { createGovernorPromptTools, createGovernorExitTools } from "./tools";
import { createFilesystemTools } from "../../agent/tools/filesystem";

export interface GovernorInterceptorOptions {
  modelName?: string;
  apiKey?: string;
  constraintsPath?: string; // Defaults to "agents/CONSTRAINTS.md" in workspace
  initialState?: Partial<GovernorState>;
}

function loadPromptFile(filename: string): string {
  try {
    const promptPath = path.resolve(import.meta.dirname, "./prompts", filename);
    return fs.readFileSync(promptPath, "utf8");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to read prompt ${filename}:`, message);
    return "";
  }
}

function extractIntentId(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  if (!("intent" in result)) return undefined;
  const rawIntent = Reflect.get(result, "intent");
  if (!rawIntent || typeof rawIntent !== "object") return undefined;
  const id = Reflect.get(rawIntent, "id");
  return typeof id === "string" ? id : undefined;
}

export class GovernorInterceptor implements AgentInterceptor {
  private constraintsPath?: string;
  private modelName: string;
  private apiKey?: string;
  name = "Governor";
  public state: GovernorState;
  public constraintsContent: string | null = null;

  constructor(options: GovernorInterceptorOptions = {}) {
    this.modelName = options.modelName ?? "gemini-2.5-flash";
    this.apiKey = options.apiKey || findApiKey();
    this.constraintsPath = options.constraintsPath;
    this.state = {
      intent_stack: options.initialState?.intent_stack ?? [],
      completed_intents: options.initialState?.completed_intents ?? [],
      global_constraints: options.initialState?.global_constraints ?? [],
    };
  }

  /**
   * Lazily loads agents/CONSTRAINTS.md from the workspace.
   */
  private ensureConstraintsLoaded(workspaceDir: string) {
    if (this.constraintsContent !== null) return;

    const targetPath = this.constraintsPath
      ? path.resolve(workspaceDir, this.constraintsPath)
      : path.resolve(workspaceDir, "agents/CONSTRAINTS.md");

    try {
      this.constraintsContent = fs.readFileSync(targetPath, "utf8");
    } catch {
      this.constraintsContent = ""; // Not found or unreadable, default empty
    }
  }

  /**
   * Entry Intercept: Runs an isolated mini-agent loop with atomic tools
   * until 'finish' is called to align user intent and constraints.
   */
  async onUserPrompt(prompt: string, context: PipelineContext): Promise<void> {
    if (!this.apiKey) throw new Error("Missing Gemini API key for Governor");
    this.ensureConstraintsLoaded(context.workspaceDir);

    let isFinished = false;
    const promptTools = createGovernorPromptTools(this.state, () => {
      isFinished = true;
    });

    const model = new ChatGoogleGenerativeAI({
      model: this.modelName,
      apiKey: this.apiKey,
      temperature: 0,
    }).bindTools(promptTools);

    const basePromptTemplate = loadPromptFile("entry.md");
    const baseConstraints = this.constraintsContent
      ? `\n## Base Project Constraints (from agents/CONSTRAINTS.md)\n${this.constraintsContent}\n`
      : "";

    const systemPrompt = `${basePromptTemplate}

## Current State
* user_intent_stack: ${JSON.stringify(this.state.intent_stack, null, 2)}
* global_constraints: ${JSON.stringify(this.state.global_constraints)}
${baseConstraints}`;

    // Isolated scratchpad history (discarded on finish)
    const scratchpad: BaseMessage[] = [new SystemMessage(systemPrompt), new HumanMessage(prompt)];

    const maxSteps = 8;
    let step = 0;

    while (!isFinished && step < maxSteps) {
      step++;
      const response = await model.invoke(scratchpad);
      scratchpad.push(response);

      if (!response.tool_calls || response.tool_calls.length === 0) {
        scratchpad.push(
          new HumanMessage(
            "Please use push_intent, add_constraint, or finish to finalize the user intent state."
          )
        );
        continue;
      }

      let callIndex = 0;
      for (const call of response.tool_calls) {
        const callId = call.id || `call_${Date.now()}_${callIndex++}`;
        call.id = callId;
        const matchingTool = promptTools.find((t) => t.name === call.name);
        if (!matchingTool) continue;

        const result = await matchingTool.invoke(call.args);
        if (call.name === "push_intent") {
          const intentId = extractIntentId(result);
          if (intentId && call.args && typeof call.args === "object") {
            Reflect.set(call.args, "id", intentId);
          }
        }
        if (context.entryToolCalls) {
          context.entryToolCalls.push({ name: call.name, args: call.args });
        }
        scratchpad.push(
          new ToolMessage({
            content: typeof result === "string" ? result : JSON.stringify(result),
            tool_call_id: callId,
            name: call.name,
          })
        );
      }
    }
  }

  /**
   * Pre-Tool Intercept: Blocks tool calls that violate constraints or active intent kind.
   */
  async onPreToolCall(toolCall: ToolCall, context: PipelineContext): Promise<ToolApproval> {
    this.ensureConstraintsLoaded(context.workspaceDir);

    const topIntent = this.state.intent_stack.at(-1);

    // If top intent is question or unknown, disallow mutating tools
    if (
      topIntent &&
      (topIntent.kind === "question" || topIntent.kind === "unknown") &&
      (toolCall.name === "write_file" || toolCall.name === "run_command")
    ) {
      const reason = `Blocked by Governor: Active user intent is of kind '${topIntent.kind}' ("${topIntent.description}"). Mutating files or executing commands is not permitted for questions or unknown intents.`;
      if (context.preToolLogs) {
        context.preToolLogs.push({
          tool: toolCall.name,
          args: toolCall.args,
          approved: false,
          reason,
        });
      }
      return {
        approved: false,
        reason,
      };
    }

    if (context.preToolLogs) {
      context.preToolLogs.push({ tool: toolCall.name, args: toolCall.args, approved: true });
    }
    return { approved: true };
  }

  /**
   * Exit Intercept: Runs an isolated mini-agent loop with inspection tools
   * until 'finish' is called with approval verdict.
   */
  async onAgentFinish(messages: BaseMessage[], context: PipelineContext): Promise<ExitVerdict> {
    this.ensureConstraintsLoaded(context.workspaceDir);

    const topIntent = this.state.intent_stack.at(-1);
    if (!topIntent && !this.constraintsContent) {
      return { allowFinish: true };
    }

    let verdict: { approved: boolean; feedback?: string; nextStep?: string } | null = null;
    const exitTools = createGovernorExitTools(this.state, (v) => {
      verdict = v;
    });

    const inspectTools = createFilesystemTools(context.workspaceDir).filter(
      (t) => t.name === "read_file" || t.name === "list_files"
    );
    const availableTools = [...inspectTools, ...exitTools];

    const model = new ChatGoogleGenerativeAI({
      model: this.modelName,
      apiKey: this.apiKey,
      temperature: 0,
    }).bindTools(availableTools);

    const basePromptTemplate = loadPromptFile("exit.md");
    const baseConstraints = this.constraintsContent
      ? `\n## Base Project Constraints (from agents/CONSTRAINTS.md)\n${this.constraintsContent}\n`
      : "";

    const systemPrompt = `${basePromptTemplate}

## Active Intent Stack
${JSON.stringify(this.state.intent_stack, null, 2)}

## Global Constraints
${JSON.stringify(this.state.global_constraints)}
${baseConstraints}`;

    const formattedConversation = messages
      .map((m) => {
        const type = m._getType();
        return `[${type}]: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`;
      })
      .join("\n");

    const scratchpad: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      new HumanMessage(`CONVERSATION TRACE:\n${formattedConversation}`),
    ];

    const maxSteps = 8;
    let step = 0;

    while (verdict === null && step < maxSteps) {
      step++;
      const response = await model.invoke(scratchpad);
      scratchpad.push(response);

      if (!response.tool_calls || response.tool_calls.length === 0) {
        scratchpad.push(
          new HumanMessage(
            "Please call resolve_intent({ id }) for satisfied intents, then call finish({ approved: boolean, feedback?: string, nextStep?: string })."
          )
        );
        continue;
      }

      let callIndex = 0;
      for (const call of response.tool_calls) {
        const callId = call.id || `call_${Date.now()}_${callIndex++}`;
        call.id = callId;
        const matchingTool = availableTools.find((t) => t.name === call.name);
        if (!matchingTool) continue;

        if (context.exitToolCalls) {
          context.exitToolCalls.push({ name: call.name, args: call.args });
        }
        const result = await matchingTool.invoke(call.args);
        scratchpad.push(
          new ToolMessage({
            content: typeof result === "string" ? result : JSON.stringify(result),
            tool_call_id: callId,
            name: call.name,
          })
        );
      }
    }

    const finalVerdict: { approved: boolean; feedback?: string; nextStep?: string } = verdict ?? {
      approved: true,
    };
    if (finalVerdict.approved) {
      return {
        allowFinish: true,
        nextStep: finalVerdict.nextStep,
      };
    }
    return {
      allowFinish: false,
      feedback: finalVerdict.feedback,
    };
  }
}
