export type ToolCallStatus = "pending" | "approved" | "rejected" | "executed";

export interface ToolCallInfo {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
  result?: unknown;
  status?: ToolCallStatus;
}

export interface AgentToolMeta {
  name: string;
  category: "filesystem" | "shell" | "other";
  description: string;
  parameters: Array<{
    name: string;
    type: string;
    required: boolean;
    description: string;
  }>;
}

export const AVAILABLE_TOOLS: AgentToolMeta[] = [
  {
    name: "read_file",
    category: "filesystem",
    description: "Read the content of a file from disk with optional line numbers (1-indexed).",
    parameters: [
      {
        name: "filePath",
        type: "string",
        required: true,
        description: "Relative or absolute path to the file",
      },
      {
        name: "startLine",
        type: "number",
        required: false,
        description: "Optional starting line number (1-indexed)",
      },
      {
        name: "endLine",
        type: "number",
        required: false,
        description: "Optional ending line number (1-indexed)",
      },
    ],
  },
  {
    name: "write_file",
    category: "filesystem",
    description: "Write or overwrite content to a file in the workspace.",
    parameters: [
      {
        name: "filePath",
        type: "string",
        required: true,
        description: "Relative path to the file",
      },
      {
        name: "content",
        type: "string",
        required: true,
        description: "The full content to write to the file",
      },
    ],
  },
  {
    name: "list_files",
    category: "filesystem",
    description: "List files and directories in a given path.",
    parameters: [
      {
        name: "directory",
        type: "string",
        required: false,
        description: "Directory to list (defaults to workspace root)",
      },
    ],
  },
  {
    name: "run_command",
    category: "shell",
    description:
      "Execute a shell command with a timeout. Only explicitly allowed commands can be run.",
    parameters: [
      {
        name: "command",
        type: "string",
        required: true,
        description: "The shell command to execute",
      },
      {
        name: "timeoutMs",
        type: "number",
        required: false,
        description: "Timeout in milliseconds (defaults to 30000)",
      },
    ],
  },
];
