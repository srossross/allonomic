import { tool, StructuredTool } from "@langchain/core/tools";
import { DEFAULT_EXECUTION_MODE, LEVEL_MODES, type AccessLevel, type UserPrompt } from "@/types";
import type { Runtime } from "../ports";
import { dirname } from "../paths";
import { createRejectedResult } from "../userPrompt";
import type { AgentToolOptions } from "./index";
import {
  currentMode,
  isConfirmedByUser,
  requiresApproval,
  type ExecutionModeSource,
} from "./approval";
import { pathLevel, sandboxVariables } from "./sandboxConfig";
import { resolveSettings } from "../config/settings";
import { TOOL_SPECS } from "./specs";

export function createFilesystemTools(
  runtime: Runtime,
  workspaceDir: string,
  executionMode: ExecutionModeSource = DEFAULT_EXECUTION_MODE,
  options: AgentToolOptions = {}
): StructuredTool[] {
  const resolvePath = (filePath: string) => runtime.paths.resolve(workspaceDir, filePath);

  const levelOf = async (access: "read" | "write", fullPath: string): Promise<AccessLevel> => {
    const { sandbox } = await resolveSettings(runtime, workspaceDir, options.sessionId);
    return pathLevel(sandbox, access, fullPath, await sandboxVariables(runtime, workspaceDir));
  };

  const rejectionIfDeclined = async (
    config: unknown,
    toolName: string,
    access: "read" | "write",
    fullPath: string,
    prompt: Extract<UserPrompt, { kind: "confirm" }>
  ): Promise<string | undefined> => {
    const level = await levelOf(access, fullPath);
    const mode = await currentMode(executionMode);
    const withModes = { ...prompt, mode: LEVEL_MODES[level], currentMode: mode };
    const isAllowed =
      !requiresApproval(level, mode) || (await isConfirmedByUser(config, withModes));
    return isAllowed ? undefined : createRejectedResult(toolName, withModes);
  };

  const readFile = tool(async ({ filePath, startLine, endLine }, config) => {
    try {
      const fullPath = await resolvePath(filePath);
      const rejection = await rejectionIfDeclined(
        config,
        TOOL_SPECS.readFile.name,
        "read",
        fullPath,
        {
          kind: "confirm",
          label: `Read ${filePath}`,
        }
      );
      if (rejection) return rejection;
      const content = await runtime.fs.readText(fullPath);
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

  const writeFile = tool(async ({ filePath, content }, config) => {
    try {
      const fullPath = await resolvePath(filePath);
      const rejection = await rejectionIfDeclined(
        config,
        TOOL_SPECS.writeFile.name,
        "write",
        fullPath,
        {
          kind: "confirm",
          label: `Write ${filePath}`,
          detail: `${content.length} bytes`,
        }
      );
      if (rejection) return rejection;
      await runtime.fs.mkdir(dirname(fullPath));
      await runtime.fs.writeText(fullPath, content);
      return `Successfully wrote ${content.length} bytes to ${filePath}`;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error writing file ${filePath}: ${message}`;
    }
  }, TOOL_SPECS.writeFile);

  const editFile = tool(async ({ filePath, oldString, newString, replaceAll }, config) => {
    try {
      if (oldString === "") return `Error editing file ${filePath}: oldString is empty`;
      if (oldString === newString) {
        return `Error editing file ${filePath}: oldString and newString are identical`;
      }
      const fullPath = await resolvePath(filePath);
      const content = await runtime.fs.readText(fullPath);
      const count = content.split(oldString).length - 1;
      if (count === 0) return `Error editing file ${filePath}: oldString not found`;
      if (count > 1 && !replaceAll) {
        return `Error editing file ${filePath}: oldString found ${count} times; add context to make it unique or set replaceAll`;
      }
      const rejection = await rejectionIfDeclined(
        config,
        TOOL_SPECS.editFile.name,
        "write",
        fullPath,
        {
          kind: "confirm",
          label: `Edit ${filePath}`,
          detail: `${count} replacement${count === 1 ? "" : "s"}`,
        }
      );
      if (rejection) return rejection;
      await runtime.fs.writeText(fullPath, content.split(oldString).join(newString));
      return `Successfully made ${count} replacement${count === 1 ? "" : "s"} in ${filePath}`;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error editing file ${filePath}: ${message}`;
    }
  }, TOOL_SPECS.editFile);

  const listFiles = tool(async ({ directory = "." }, config) => {
    try {
      const fullPath = await resolvePath(directory);
      const rejection = await rejectionIfDeclined(
        config,
        TOOL_SPECS.listFiles.name,
        "read",
        fullPath,
        {
          kind: "confirm",
          label: `List ${directory}`,
        }
      );
      if (rejection) return rejection;
      const entries = await runtime.fs.readDir(fullPath);
      return entries
        .map((entry) => `${entry.isDirectory ? "[DIR]" : "[FILE]"} ${entry.name}`)
        .join("\n");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error listing directory ${directory}: ${message}`;
    }
  }, TOOL_SPECS.listFiles);

  return [readFile, writeFile, editFile, listFiles];
}
