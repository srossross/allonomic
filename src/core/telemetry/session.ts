import YAML from "yaml";
import type { BaseMessage } from "@langchain/core/messages";
import type { FileStore } from "../ports";
import { join } from "../paths";
import { TURN_EVENTS_FILE, type TurnEvent } from "../turn/events";
import { turnDirName } from "../turn/turnFiles";

export function generateSessionId(size: number = 8): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let id = "";
  for (let index = 0; index < size; index++) {
    id += alphabet[bytes[index] % alphabet.length];
  }
  return id;
}

export interface TurnData {
  turnIndex: number;
  userPrompt: string;
  agentResponse: string;
  thinking?: string;
  agentMessages: BaseMessage[];
  events: TurnEvent[];
}

function serializeMessages(messages: BaseMessage[]) {
  return messages.map((m) => {
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
    const toolCallId = "tool_call_id" in m ? m.tool_call_id : undefined;
    return {
      type: m._getType(),
      name: m.name,
      content: m.content,
      thinking,
      tool_calls: toolCalls,
      tool_call_id: toolCallId,
    };
  });
}

export function turnDirFor(sessionDir: string, turnIndex: number): string {
  return join(sessionDir, "turns", turnDirName(turnIndex));
}

async function writeEvents(fs: FileStore, turnDir: string, events: TurnEvent[]) {
  await fs.writeText(join(turnDir, TURN_EVENTS_FILE), YAML.stringify({ version: 1, events }));
}

export async function saveTurn(fs: FileStore, sessionDir: string, data: TurnData): Promise<string> {
  const turnDir = turnDirFor(sessionDir, data.turnIndex);
  await fs.mkdir(turnDir);

  const now = new Date().toISOString();

  await fs.writeText(
    join(turnDir, "user.yml"),
    YAML.stringify({ prompt: data.userPrompt, timestamp: now })
  );
  await fs.writeText(
    join(turnDir, "agent.yml"),
    YAML.stringify({
      final_response: data.agentResponse,
      thinking: data.thinking || undefined,
      messages: serializeMessages(data.agentMessages),
      timestamp: now,
    })
  );
  await writeEvents(fs, turnDir, data.events);

  return turnDir;
}

export async function appendTraceLog(
  fs: FileStore,
  sessionDir: string,
  message: string
): Promise<void> {
  try {
    await fs.mkdir(sessionDir);
    const entry = `[${new Date().toISOString()}] ${message}\n`;
    await fs.writeText(join(sessionDir, "trace.log"), entry, { append: true });
  } catch (error) {
    console.warn("[appendTraceLog] Failed to write trace:", error);
  }
}

export interface TurnErrorData {
  turnIndex: number;
  userPrompt: string;
  error: unknown;
  agentMessages?: BaseMessage[];
  events: TurnEvent[];
}

export async function saveTurnError(
  fs: FileStore,
  sessionDir: string,
  data: TurnErrorData
): Promise<string> {
  const turnDir = turnDirFor(sessionDir, data.turnIndex);
  await fs.mkdir(turnDir);

  const now = new Date().toISOString();

  await fs.writeText(
    join(turnDir, "user.yml"),
    YAML.stringify({ prompt: data.userPrompt, timestamp: now })
  );

  const errorObject = {
    error: data.error instanceof Error ? data.error.message : String(data.error),
    stack: data.error instanceof Error ? data.error.stack : undefined,
    timestamp: now,
  };
  await fs.writeText(join(turnDir, "error.yml"), YAML.stringify(errorObject));

  if (data.agentMessages && data.agentMessages.length > 0) {
    await fs.writeText(
      join(turnDir, "agent.yml"),
      YAML.stringify({
        final_response: "",
        messages: serializeMessages(data.agentMessages),
        timestamp: now,
      })
    );
  }
  await writeEvents(fs, turnDir, data.events);

  await appendTraceLog(
    fs,
    sessionDir,
    `[ERROR] Turn ${data.turnIndex} failed: ${errorObject.error}`
  );

  return turnDir;
}

export { resumeFromDir, type ResumeResult } from "./sessionReplay";
