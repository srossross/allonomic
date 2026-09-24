import { tool, StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import * as fs from "node:fs/promises";
import path from "node:path";
import type { ExecutionMode } from "@/types";

export function createFilesystemTools(
  workspaceDir: string = process.cwd(),
  executionMode: ExecutionMode = "accept edits"
): StructuredTool[] {
  const resolvePath = (filePath: string) => path.resolve(workspaceDir, filePath);

  const readFile = tool(
    async ({ filePath, startLine, endLine }) => {
      try {
        const fullPath = resolvePath(filePath);
        const content = await fs.readFile(fullPath, "utf8");
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
    },
    {
      name: "read_file",
      description: "Read the content of a file from disk with optional line numbers (1-indexed).",
      schema: z.object({
        filePath: z.string().describe("Relative or absolute path to the file"),
        startLine: z.number().optional().describe("Optional starting line number (1-indexed)"),
        endLine: z.number().optional().describe("Optional ending line number (1-indexed)"),
      }),
    }
  );

  const writeFile = tool(
    async ({ filePath, content }) => {
      if (executionMode === "manual") {
        return `[PENDING_APPROVAL]: Write to ${filePath} (${content.length} bytes) requires user approval in Manual mode. The file was NOT written yet. Changes are staged and paused pending user approval.`;
      }
      try {
        const fullPath = resolvePath(filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, "utf8");
        return `Successfully wrote ${content.length} bytes to ${filePath}`;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error writing file ${filePath}: ${message}`;
      }
    },
    {
      name: "write_file",
      description: "Write or overwrite content to a file.",
      schema: z.object({
        filePath: z.string().describe("Relative path to the file"),
        content: z.string().describe("The full content to write to the file"),
      }),
    }
  );

  const listFiles = tool(
    async ({ directory = "." }) => {
      try {
        const dirPath = resolvePath(directory);
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return entries
          .map((entry) => `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`)
          .join("\n");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error listing directory ${directory}: ${message}`;
      }
    },
    {
      name: "list_files",
      description: "List files and directories in a given path.",
      schema: z.object({
        directory: z
          .string()
          .optional()
          .default(".")
          .describe("Directory to list (defaults to current dir)"),
      }),
    }
  );

  return [readFile, writeFile, listFiles];
}
