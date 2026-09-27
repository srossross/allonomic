import { z } from "zod";

export type ToolCategory = "filesystem" | "shell" | "other";

export interface ToolSpec {
  name: string;
  category: ToolCategory;
  description: string;
  schema: z.AnyZodObject;
}

export const TOOL_SPECS = {
  readFile: {
    name: "read_file",
    category: "filesystem",
    description: "Read the content of a file from disk with optional line numbers (1-indexed).",
    schema: z.object({
      filePath: z.string().describe("Relative or absolute path to the file"),
      startLine: z.number().optional().describe("Optional starting line number (1-indexed)"),
      endLine: z.number().optional().describe("Optional ending line number (1-indexed)"),
    }),
  },
  writeFile: {
    name: "write_file",
    category: "filesystem",
    description: "Write or overwrite content to a file.",
    schema: z.object({
      filePath: z.string().describe("Relative path to the file"),
      content: z.string().describe("The full content to write to the file"),
    }),
  },
  listFiles: {
    name: "list_files",
    category: "filesystem",
    description: "List files and directories in a given path.",
    schema: z.object({
      directory: z
        .string()
        .optional()
        .default(".")
        .describe("Directory to list (defaults to current dir)"),
    }),
  },
  runReadOnlyCommand: {
    name: "run_read_only_command",
    category: "shell",
    description:
      "Execute a strictly read-only shell command inside the devcontainer sandbox (using bwrap). Will fail if it attempts to mutate files.",
    schema: z.object({
      command: z.string().describe("The read-only shell command to execute"),
    }),
  },
  runMutatingCommand: {
    name: "run_mutating_command",
    category: "shell",
    description:
      "Execute a shell command that may mutate files or state. Requires user approval in manual mode.",
    schema: z.object({
      command: z.string().describe("The shell command to execute"),
    }),
  },
  runNativeReadOnlyCommand: {
    name: "run_native_read_only_command",
    category: "shell",
    description:
      "Execute a strictly read-only shell command directly on the host, sandboxed by the OS (seatbelt on macOS). Will fail if it attempts to mutate files. Always requires user approval.",
    schema: z.object({
      command: z.string().describe("The read-only shell command to execute"),
    }),
  },
} satisfies Record<string, ToolSpec>;
