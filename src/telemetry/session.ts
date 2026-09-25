import * as fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import YAML from "yaml";
import type { BaseMessage } from "@langchain/core/messages";

export function generateSessionId(size: number = 8): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(size);
  let id = "";
  for (let index = 0; index < size; index++) {
    id += alphabet[bytes[index] % alphabet.length];
  }
  return id;
}

export interface InterceptorActionLog {
  name: string;
  args?: Record<string, unknown>;
  timestamp?: string;
}

export interface PreToolLog {
  tool: string;
  args?: Record<string, unknown>;
  approved: boolean;
  reason?: string;
}

export interface TurnData {
  turnIndex: number;
  userPrompt: string;
  agentResponse: string;
  thinking?: string;
  agentMessages: BaseMessage[];
  entryToolCalls?: InterceptorActionLog[];
  preToolLogs?: PreToolLog[];
  exitToolCalls?: InterceptorActionLog[];
}

export async function saveTurn(sessionDir: string, data: TurnData): Promise<string> {
  const turnString = String(data.turnIndex).padStart(3, "0");
  const turnDir = path.resolve(sessionDir, "turns", turnString);
  const interceptorsDir = path.join(turnDir, "interceptors");

  await fs.mkdir(interceptorsDir, { recursive: true });

  const now = new Date().toISOString();

  // 1. user.yml
  const userYml = YAML.stringify({
    prompt: data.userPrompt,
    timestamp: now,
  });
  await fs.writeFile(path.join(turnDir, "user.yml"), userYml, "utf8");

  // 2. agent.yml
  const serializedMessages = data.agentMessages.map((m) => {
    const additional =
      "additional_kwargs" in m &&
      typeof m.additional_kwargs === "object" &&
      m.additional_kwargs !== null
        ? m.additional_kwargs
        : undefined;
    const thinking =
      additional && "thinking" in additional && typeof additional.thinking === "string"
        ? additional.thinking
        : undefined;
    const toolCalls = "tool_calls" in m ? m.tool_calls : undefined;
    return {
      type: m._getType(),
      content: m.content,
      thinking,
      tool_calls: toolCalls,
    };
  });

  const agentYml = YAML.stringify({
    final_response: data.agentResponse,
    thinking: data.thinking || undefined,
    messages: serializedMessages,
    timestamp: now,
  });
  await fs.writeFile(path.join(turnDir, "agent.yml"), agentYml, "utf8");

  // 3. interceptors/entry.yml
  if (data.entryToolCalls && data.entryToolCalls.length > 0) {
    const entryYml = YAML.stringify({
      tool_calls: data.entryToolCalls,
      timestamp: now,
    });
    await fs.writeFile(path.join(interceptorsDir, "entry.yml"), entryYml, "utf8");
  }

  // 4. interceptors/pre_tools.yml
  if (data.preToolLogs && data.preToolLogs.length > 0) {
    const preToolsYml = YAML.stringify(data.preToolLogs);
    await fs.writeFile(path.join(interceptorsDir, "pre_tools.yml"), preToolsYml, "utf8");
  }

  // 5. interceptors/exit.yml
  if (data.exitToolCalls && data.exitToolCalls.length > 0) {
    const exitYml = YAML.stringify({
      tool_calls: data.exitToolCalls,
      timestamp: now,
    });
    await fs.writeFile(path.join(interceptorsDir, "exit.yml"), exitYml, "utf8");
  }

  return turnDir;
}

export async function appendTraceLog(sessionDir: string, message: string): Promise<void> {
  try {
    await fs.mkdir(sessionDir, { recursive: true });
    const logPath = path.join(sessionDir, "trace.log");
    const entry = `[${new Date().toISOString()}] ${message}\n`;
    await fs.appendFile(logPath, entry, "utf8");
  } catch (error) {
    console.warn("[appendTraceLog] Failed to write trace:", error);
  }
}

export interface TurnErrorData {
  turnIndex: number;
  userPrompt: string;
  error: unknown;
  entryToolCalls?: InterceptorActionLog[];
  preToolLogs?: PreToolLog[];
  exitToolCalls?: InterceptorActionLog[];
}

export async function saveTurnError(sessionDir: string, data: TurnErrorData): Promise<string> {
  const turnString = String(data.turnIndex).padStart(3, "0");
  const turnDir = path.resolve(sessionDir, "turns", turnString);
  await fs.mkdir(turnDir, { recursive: true });

  const now = new Date().toISOString();

  // 1. user.yml
  const userYml = YAML.stringify({
    prompt: data.userPrompt,
    timestamp: now,
  });
  await fs.writeFile(path.join(turnDir, "user.yml"), userYml, "utf8");

  // 2. error.yml
  const errorObject = {
    error: data.error instanceof Error ? data.error.message : String(data.error),
    stack: data.error instanceof Error ? data.error.stack : undefined,
    timestamp: now,
    entryToolCalls: data.entryToolCalls,
    preToolLogs: data.preToolLogs,
    exitToolCalls: data.exitToolCalls,
  };
  await fs.writeFile(path.join(turnDir, "error.yml"), YAML.stringify(errorObject), "utf8");

  // Also log to trace.log
  await appendTraceLog(sessionDir, `[ERROR] Turn ${data.turnIndex} failed: ${errorObject.error}`);

  return turnDir;
}

export { resumeFromDir, type ResumeResult } from "./sessionReplay";
