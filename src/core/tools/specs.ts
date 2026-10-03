import { z } from "zod";

export type ToolCategory = "filesystem" | "shell" | "other";

export interface ToolSpec {
  name: string;
  category: ToolCategory;
  description: string;
  schema: z.AnyZodObject;
}

const shellSchema = z.object({
  command: z.string().describe("The shell command to execute"),
  background: z
    .boolean()
    .optional()
    .describe(
      "Run as a background job and return immediately with a job id, for servers and other long-running processes. Its stdout and stderr are appended to the log file named in the result; read that file to see later output. Stop it with shell_job_kill. Do not append & to the command."
    ),
  wait_for: z
    .string()
    .optional()
    .describe(
      "With background: a regex; returns once the job's output matches it (e.g. a server's ready line), the job exits, or 30s pass."
    ),
});

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
  editFile: {
    name: "edit_file",
    category: "filesystem",
    description:
      "Replace an exact string in a file. Fails if oldString is not found, or is found more than once and replaceAll is not set.",
    schema: z.object({
      filePath: z.string().describe("Relative path to the file"),
      oldString: z.string().describe("Exact text to replace, including whitespace and indentation"),
      newString: z.string().describe("Text to replace it with"),
      replaceAll: z.boolean().optional().describe("Replace every occurrence of oldString"),
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
  shellProjectReadOnly: {
    name: "shell_1_project_read_only",
    category: "shell",
    description:
      "Run a shell command that can read the project but cannot modify it or read the user's other files. For inspecting a project that may be untrusted: listing, searching, reading. Allowed paths are set in the sandbox config.",
    schema: shellSchema,
  },
  shellReadOnly: {
    name: "shell_2_read_only",
    category: "shell",
    description:
      "Run a shell command that can read the whole filesystem and write to package/build caches, but cannot modify the project. For commands that need installed toolchains or caches without changing the project, such as type-checking or dependency resolution. Allowed paths are set in the sandbox config.",
    schema: shellSchema,
  },
  shellProjectWrite: {
    name: "shell_3_project_write",
    category: "shell",
    description:
      "Run a shell command that can also modify the project. For commands that change the project, such as installing dependencies, formatting, code generation, or builds that write into the tree. Allowed paths are set in the sandbox config.",
    schema: shellSchema,
  },
  shellFullAccess: {
    name: "shell_4_full_access",
    category: "shell",
    description:
      "Run a shell command with no sandbox and the user's full access to the machine. For commands the sandboxed shells cannot run.",
    schema: shellSchema,
  },
  shellJobKill: {
    name: "shell_job_kill",
    category: "other",
    description: "Stop a background job and its child processes.",
    schema: z.object({
      job_id: z.string().describe("The job id returned when the job was started"),
    }),
  },
  modifySandboxPermissions: {
    name: "modify_sandbox_permissions",
    category: "other",
    description:
      "Ask the user to change the sandbox: allow a path to be read or written at a sandbox level, deny a path, or turn network access for sandboxed shells on or off. One change per call. The user always decides and picks whether it applies to this session, this project, or globally.",
    schema: z.object({
      op: z
        .enum(["allow_read", "allow_write", "deny", "network_on", "network_off"])
        .describe("The change to request"),
      path: z
        .string()
        .optional()
        .describe(
          "Required for allow_read, allow_write and deny. Must start with /, ~, $PROJECT or $TMP"
        ),
      level: z
        .number()
        .int()
        .optional()
        .describe("Required for allow_read and allow_write: sandbox level 1, 2 or 3"),
      reason: z.string().describe("Why the change is needed; shown to the user"),
    }),
  },
  webSearch: {
    name: "web_search",
    category: "other",
    description:
      "Search the web. Returns the title, URL and a content excerpt for each result. Use web_fetch to read a result in full.",
    schema: z.object({
      query: z.string().describe("The search query"),
      limit: z.number().int().optional().default(5).describe("Maximum number of results, 1-20"),
    }),
  },
  webFetch: {
    name: "web_fetch",
    category: "other",
    description:
      "Fetch a web page and return its main content as markdown, without navigation, scripts or styles.",
    schema: z.object({
      url: z.string().describe("The URL to fetch"),
    }),
  },
} satisfies Record<string, ToolSpec>;
