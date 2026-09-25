import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { MessagesAnnotation, StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import type { BaseMessageLike } from "@langchain/core/messages";
import { createAgentTools } from "./tools";
import { logConversation } from "../telemetry/logger";
import { findApiKey } from "../common/env";

export interface WorkerAgentOptions {
  workspaceDir?: string;
  modelName?: string;
  apiKey?: string;
  enableTools?: boolean;
  systemPrompt?: string;
}

import * as fs from "node:fs";
import path from "node:path";

function loadWorkerPrompt(): string {
  try {
    const promptPath = path.resolve(import.meta.dirname, "./prompts/worker.md");
    return fs.readFileSync(promptPath, "utf8");
  } catch {
    return "You are an expert software engineer with access to local tools. Inspect the codebase, read relevant files, and fulfill user requests directly.";
  }
}

export function createWorkerAgent(options: WorkerAgentOptions = {}) {
  const apiKey = options.apiKey || findApiKey();
  if (!apiKey)
    throw new Error("Missing Gemini API key. Set API_KEY in .env or pass it explicitly.");

  const workspaceDir = options.workspaceDir || process.cwd();
  const enableTools = options.enableTools ?? true;
  const systemPrompt = options.systemPrompt ?? loadWorkerPrompt();

  const systemMessage = {
    role: "system",
    content: systemPrompt,
  };

  const workflow = new StateGraph(MessagesAnnotation);

  if (enableTools) {
    const tools = createAgentTools(workspaceDir);
    const toolNode = new ToolNode(tools);

    const model = new ChatGoogleGenerativeAI({
      model: options.modelName ?? "gemini-3.8-flash",
      apiKey,
      temperature: 0,
    }).bindTools(tools);

    const callModel = async (state: typeof MessagesAnnotation.State) => {
      const messages = [systemMessage, ...state.messages];
      const response = await model.invoke(messages);
      return { messages: [response] };
    };

    workflow
      .addNode("agent", callModel)
      .addNode("tools", toolNode)
      .addEdge(START, "agent")
      .addConditionalEdges("agent", toolsCondition)
      .addEdge("tools", "agent");
  } else {
    // Pure conversational without tools
    const model = new ChatGoogleGenerativeAI({
      model: options.modelName ?? "gemini-3.8-flash",
      apiKey,
      temperature: 0.7,
    });

    const callModel = async (state: typeof MessagesAnnotation.State) => {
      const messages = [systemMessage, ...state.messages];
      const response = await model.invoke(messages);
      return { messages: [response] };
    };

    workflow.addNode("agent", callModel).addEdge(START, "agent").addEdge("agent", END);
  }

  const checkpointer = new MemorySaver();
  const compiled = workflow.compile({ checkpointer });

  return {
    compiled,
    async run(messages: BaseMessageLike[], threadId: string = "default") {
      const result = await compiled.invoke({ messages }, { configurable: { thread_id: threadId } });
      const logPath = await logConversation(result.messages, workspaceDir);
      return { result, logPath };
    },
  };
}

export type WorkerAgent = ReturnType<typeof createWorkerAgent>;
