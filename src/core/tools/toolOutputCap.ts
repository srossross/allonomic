import { ToolMessage } from "@langchain/core/messages";
import type { Runtime } from "../ports";
import { join } from "../paths";
import { sandboxVariables } from "./sandboxConfig";
import { withFullOutputPath } from "./shellResult";

export const TOOL_OUTPUT_LIMIT = 50_000;
const HALF = TOOL_OUTPUT_LIMIT / 2;

export type ToolOutputStore = (toolCallId: string, content: string) => Promise<string>;

export function capToolOutput(content: string, path: string): string {
  const omitted = content.length - TOOL_OUTPUT_LIMIT;
  const capped = `${content.slice(0, HALF)}\n[... ${omitted} chars omitted ...]\n${content.slice(-HALF)}`;
  return withFullOutputPath(capped, path);
}

export async function capToolMessage(
  message: ToolMessage,
  store: ToolOutputStore | undefined
): Promise<ToolMessage> {
  const content =
    typeof message.content === "string" ? message.content : JSON.stringify(message.content);
  if (!store || content.length <= TOOL_OUTPUT_LIMIT) return message;
  const path = await store(message.tool_call_id, content);
  return new ToolMessage({
    content: capToolOutput(content, path),
    tool_call_id: message.tool_call_id,
    name: message.name,
    status: message.status,
  });
}

export function createToolOutputStore(
  runtime: Runtime,
  workspaceDir: string,
  sessionId: string
): ToolOutputStore {
  return async (toolCallId, content) => {
    const { tmp } = await sandboxVariables(runtime, workspaceDir);
    const dir = join(tmp, "tool-output", sessionId);
    const path = join(dir, `${toolCallId}.txt`);
    await runtime.fs.mkdir(dir);
    await runtime.fs.writeText(path, content);
    return path;
  };
}
