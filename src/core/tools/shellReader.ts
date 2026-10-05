import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, type AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { Runtime } from "../ports";
import type { TurnEventSink } from "../turn/events";
import { findApiKey } from "../../common/env";
import { resolveSettings } from "../config/settings";
import { loadModels } from "../models";
import { loadPromptFile } from "../governor/prompts";
import { messageText, thinkingConfigFor } from "../graph/thinking";
import { emitModelUsage } from "../turn/usage";
import { THINKING_BUDGETS } from "../../types/tab";

export const SHELL_READER = "ShellReader";
const PROMPT_DIR = "shell_reader";
const CHARS_PER_TOKEN_BUDGET = 2;
const NO_MATCH = "(no lines match the query)";

export interface ShellReaderModel {
  invoke(messages: BaseMessage[]): Promise<AIMessage>;
}

export type CreateShellReaderModel = (
  modelName: string,
  thinkingBudget: number
) => ShellReaderModel;

export interface ShellReaderDeps {
  runtime: Runtime;
  workspaceDir: string;
  sessionId?: string;
  events?: TurnEventSink;
  createModel?: CreateShellReaderModel;
}

export interface ShellQuery {
  command: string;
  query: string;
  output: string;
}

function createGeminiReader(modelName: string, thinkingBudget: number): ShellReaderModel {
  const apiKey = findApiKey();
  if (!apiKey) throw new Error(`Missing Gemini API key for ${SHELL_READER}`);
  const thinkingConfig = thinkingConfigFor(thinkingBudget);
  return new ChatGoogleGenerativeAI({
    model: modelName,
    apiKey,
    temperature: 0,
    ...(thinkingConfig && { thinkingConfig }),
  });
}

export function numberLines(lines: string[], first = 1): string[] {
  return lines.map((line, index) => `L${first + index}: ${line}`);
}

function chunkNumbered(numbered: string[], maxChars: number): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const line of numbered) {
    if (current.length > 0 && size + line.length + 1 > maxChars) {
      chunks.push(current.join("\n"));
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}

export function verifiedLines(answer: string, lines: string[]): Map<number, string> {
  const kept = new Map<number, string>();
  for (const candidate of answer.split("\n")) {
    const match = /^L(\d+): ?(.*)$/.exec(candidate.trim());
    if (!match) continue;
    const number = Number(match[1]);
    const text = match[2];
    if (lines[number - 1] === text || lines[number - 1]?.trim() === text.trim())
      kept.set(number, lines[number - 1]);
  }
  return kept;
}

async function readerModel(deps: ShellReaderDeps) {
  const settings = await resolveSettings(deps.runtime, deps.workspaceDir, deps.sessionId);
  const { model = settings.model, thinkingLevel = "Off" } =
    settings.interceptors[SHELL_READER] ?? {};
  const models = await loadModels(deps.runtime, deps.workspaceDir);
  const option = models.find((m) => m.id === model);
  const level =
    option && !option.thinking.includes(thinkingLevel) ? option.thinking[0] : thinkingLevel;
  return {
    modelName: model,
    maxChars: (option?.inputTokenLimit ?? 1_000_000) * CHARS_PER_TOKEN_BUDGET,
    create: () => (deps.createModel ?? createGeminiReader)(model, THINKING_BUDGETS[level]),
  };
}

export async function answerShellQuery(
  deps: ShellReaderDeps,
  request: ShellQuery
): Promise<string> {
  const [prompt, reader] = await Promise.all([
    loadPromptFile(deps.runtime, "reader.md", PROMPT_DIR),
    readerModel(deps),
  ]);
  const lines = request.output.split("\n");
  const model = reader.create();
  const kept = new Set<number>();
  const chunks = chunkNumbered(numberLines(lines), reader.maxChars);
  for (const chunk of chunks) {
    const response = await model.invoke([
      new HumanMessage(
        `${prompt.text.trim()}\n\n## Command\n${request.command}\n\n## Query\n${request.query}\n\n## Output\n${chunk}`
      ),
    ]);
    if (deps.events)
      emitModelUsage(deps.events, `tool/${SHELL_READER}`, reader.modelName, response);
    const verified = verifiedLines(messageText(response.content), lines);
    for (const number of verified.keys()) kept.add(number);
  }
  return kept.size === 0
    ? NO_MATCH
    : lines
        .flatMap((text, index) => (kept.has(index + 1) ? [`L${index + 1}: ${text}`] : []))
        .join("\n");
}
