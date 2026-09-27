import { tool, StructuredTool } from "@langchain/core/tools";
import type { ExecutionMode } from "@/types";
import type { Runtime } from "../ports";
import { dirname } from "../paths";
import { createPendingResult } from "../userPrompt";
import type { AgentToolOptions } from "./index";
import { TOOL_SPECS } from "./specs";

export function createFilesystemTools(
  runtime: Runtime,
  workspaceDir: string,
  executionMode: ExecutionMode = "accept edits",
  options: AgentToolOptions = {}
): StructuredTool[] {
  const resolvePath = (filePath: string) => runtime.paths.resolve(workspaceDir, filePath);

  const readFile = tool(async ({ filePath, startLine, endLine }) => {
    try {
      const content = await runtime.fs.readText(await resolvePath(filePath));
      const lines = content.split("\n");

      if (startLine !== undefined || endLine !== undefined) {
        const start = Math.max(1, startLine ?? 1) - 1;
        const end = Math.min(lines.length, endLine ?? lines.length);
        return lines.slice(start, end).join("\n");
      }
      return content;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error reading file ${filePath}: ${message}`;
    }
  }, TOOL_SPECS.readFile);

  const writeFile = tool(async ({ filePath, content }) => {
    if (executionMode === "manual" && !options.approved) {
      return createPendingResult({
        kind: "confirm",
        label: `Write ${filePath}`,
        detail: `${content.length} bytes`,
      });
    }
    try {
      const fullPath = await resolvePath(filePath);
      await runtime.fs.mkdir(dirname(fullPath));
      await runtime.fs.writeText(fullPath, content);
      return `Successfully wrote ${content.length} bytes to ${filePath}`;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error writing file ${filePath}: ${message}`;
    }
  }, TOOL_SPECS.writeFile);

  const listFiles = tool(async ({ directory = "." }) => {
    try {
      const entries = await runtime.fs.readDir(await resolvePath(directory));
      return entries
        .map((entry) => `${entry.isDirectory ? "[DIR]" : "[FILE]"} ${entry.name}`)
        .join("\n");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error listing directory ${directory}: ${message}`;
    }
  }, TOOL_SPECS.listFiles);

  return [readFile, writeFile, listFiles];
}
