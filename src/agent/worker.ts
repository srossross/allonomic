import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { Runtime } from "../core/ports";
import { MessagesAnnotation, StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import type { BaseMessageLike } from "@langchain/core/messages";
import { createAgentTools } from "../core/tools";
import { logConversation } from "../core/telemetry/logger";
import { findApiKey } from "../common/env";
import { join, dirname } from "../core/paths";

export interface WorkerAgentOptions {
  runtime: Runtime;
  workspaceDir?: string;
  modelName?: string;
  apiKey?: string;
  enableTools?: boolean;
  systemPrompt?: string;
}

const AGENT_FILES = ["AGENTS.md", "CLAUDE.md"];

async function loadWorkerTemplate(runtime: Runtime): Promise<string> {
  try {
    const resourcePath = await runtime.paths.resource("app-data/prompts/worker.md");
    return await runtime.fs.readText(resourcePath);
  } catch {
    return "You are an expert software engineer with access to local tools. Inspect the codebase, read relevant files, and fulfill user requests directly.";
  }
}

async function loadAgentFiles(runtime: Runtime, workspaceDir: string): Promise<string[]> {
  const sections: string[] = [];
  let dir = await runtime.paths.resolve(workspaceDir);
  while (true) {
    const found: string[] = [];
    for (const name of AGENT_FILES) {
      const path = join(dir, name);
      if (await runtime.fs.exists(path))
        found.push(`# ${path}\n\n${await runtime.fs.readText(path)}`);
    }
    sections.unshift(...found);
    const parent = dirname(dir);
    if (parent === dir) return sections;
    dir = parent;
  }
}

export async function loadWorkerPrompt(runtime: Runtime, workspaceDir: string): Promise<string> {
  const [template, agentFiles] = await Promise.all([
    loadWorkerTemplate(runtime),
    loadAgentFiles(runtime, workspaceDir),
  ]);
  return [template, ...agentFiles].join("\n\n");
}

export async function createWorkerAgent(options: WorkerAgentOptions) {
  const apiKey = options.apiKey || findApiKey();
  if (!apiKey)
    throw new Error("Missing Gemini API key. Set API_KEY in .env or pass it explicitly.");

  const { runtime } = options;
  const workspaceDir = options.workspaceDir || ".";
  const enableTools = options.enableTools ?? true;
  const systemPrompt = options.systemPrompt ?? (await loadWorkerPrompt(runtime, workspaceDir));

  const systemMessage = {
    role: "system",
    content: systemPrompt,
  };

  const workflow = new StateGraph(MessagesAnnotation);

  if (enableTools) {
    const tools = createAgentTools(runtime, workspaceDir);
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
      const logPath = await logConversation(runtime.fs, result.messages, workspaceDir);
      return { result, logPath };
    },
  };
}

export type WorkerAgent = ReturnType<typeof createWorkerAgent>;
