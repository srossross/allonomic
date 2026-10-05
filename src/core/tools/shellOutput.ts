import type { Runtime } from "../ports";
import type { TurnEventSink } from "../turn/events";
import { dirname, join } from "../paths";
import { sandboxVariables } from "./sandboxConfig";
import { formatStoredView, splitShellFooter } from "./shellResult";
import { answerShellQuery, numberLines, type CreateShellReaderModel } from "./shellReader";
import { INLINE_OUTPUT_LIMIT } from "./shellLimits";

const PREVIEW_LINES = 20;

export interface ShellOutputOptions {
  sessionId?: string;
  createReaderModel?: CreateShellReaderModel;
}

export interface PresentRequest {
  callId: string;
  command: string;
  content: string;
  query?: string;
  storedPath?: string;
  events?: TurnEventSink;
}

export async function shellOutputPath(
  runtime: Runtime,
  workspaceDir: string,
  sessionId: string | undefined,
  callId: string
): Promise<string> {
  const { tmp } = await sandboxVariables(runtime, workspaceDir);
  return join(tmp, "shell-output", sessionId ?? "default", `${callId}.txt`);
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

export function selectLines(content: string, range: string): string {
  const match = /^(\d+)(?:-(\d+))?$/.exec(range.trim());
  if (!match) return `Error: lines must look like 200-260, got ${JSON.stringify(range)}`;
  const first = Math.max(1, Number(match[1]));
  const last = Number(match[2] ?? match[1]);
  const lines = content.split("\n").slice(first - 1, last);
  return lines.length > 0
    ? numberLines(lines, first).join("\n")
    : `(no lines in range ${range}; the output has ${content.split("\n").length} lines)`;
}

function preview(lines: string[]): string {
  if (lines.length <= PREVIEW_LINES * 2) return lines.join("\n");
  const omitted = lines.length - PREVIEW_LINES * 2;
  return [
    ...lines.slice(0, PREVIEW_LINES),
    `[... ${omitted} lines omitted ...]`,
    ...lines.slice(-PREVIEW_LINES),
  ].join("\n");
}

export function createShellOutputs(
  runtime: Runtime,
  workspaceDir: string,
  options: ShellOutputOptions = {}
) {
  const store = async (callId: string, content: string) => {
    const path = await shellOutputPath(runtime, workspaceDir, options.sessionId, callId);
    await runtime.fs.mkdir(dirname(path));
    await runtime.fs.writeText(path, content);
    return path;
  };

  const query = (command: string, question: string, output: string, events?: TurnEventSink) =>
    answerShellQuery(
      {
        runtime,
        workspaceDir,
        sessionId: options.sessionId,
        events,
        createModel: options.createReaderModel,
      },
      { command, query: question, output }
    );

  const present = async (request: PresentRequest): Promise<string> => {
    const { callId, command, content, events } = request;
    const path = request.storedPath ?? (await store(callId, content));
    const lines = content.split("\n");
    events?.emit({
      type: "tool_output_stored",
      toolCallId: callId,
      path,
      chars: content.length,
      lines: lines.length,
    });
    if (content.length <= INLINE_OUTPUT_LIMIT) return content;
    const { body, footer } = splitShellFooter(content);
    const header = `[output: ${lines.length} lines, ${content.length} chars; stored as ${callId}; read_shell to see more]`;
    const view = request.query
      ? await query(command, request.query, content, events)
      : preview(body.split("\n"));
    return formatStoredView(header, view, footer);
  };

  return { present, query };
}

export type ShellOutputs = ReturnType<typeof createShellOutputs>;
