import { tool } from "@langchain/core/tools";
import { rethrowIfFatal } from "./fatal";
import { DEFAULT_EXECUTION_MODE, LEVEL_MODES, type AccessLevel } from "@/types";
import type { Runtime, ShellResult } from "../ports";
import { createRejectedResult } from "../userPrompt";
import type { AgentToolOptions } from "./index";
import {
  currentMode,
  isConfirmedByUser,
  requiresApproval,
  type ExecutionModeSource,
} from "./approval";
import { TOOL_SPECS } from "./specs";
import { formatShellResult } from "./shellResult";
import { resolveSettings } from "../config/settings";
import {
  SANDBOX_TMP_ROOT,
  sandboxRules,
  sandboxVariables,
  type SandboxLevel,
  type SandboxRules,
  type SandboxVariables,
} from "./sandboxConfig";

function subpaths(prefix: string, count: number): string {
  return Array.from(
    { length: count },
    (_, index) => ` (subpath (param "${prefix}_${index}"))`
  ).join("");
}

export function seatbeltProfile(rules: SandboxRules, hasNetwork: boolean): string {
  const profile = [
    "(version 1)",
    "(allow default)",
    "(deny file-read-data)",
    `(allow file-read-data (literal "/")${subpaths("READ", rules.read.length)})`,
    "(deny file-write*)",
    `(allow file-write*
  (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr")
  (literal "/dev/tty") (literal "/dev/dtracehelper")
  (literal "${SANDBOX_TMP_ROOT}")${subpaths("WRITE", rules.write.length)})`,
  ];
  if (rules.deny.length > 0)
    profile.push(`(deny file-read-data file-write*${subpaths("DENY", rules.deny.length)})`);
  if (!hasNetwork) profile.push("(deny network-outbound (remote ip))");
  return profile.join("\n");
}

function sandboxParams(rules: SandboxRules): string[] {
  const params = [
    ...rules.read.map((path, index) => `READ_${index}=${path}`),
    ...rules.write.map((path, index) => `WRITE_${index}=${path}`),
    ...rules.deny.map((path, index) => `DENY_${index}=${path}`),
  ];
  return params.flatMap((param) => ["-D", param]);
}

function sandboxInvocation(
  platform: string,
  rules: SandboxRules,
  hasNetwork: boolean,
  { project, tmp }: SandboxVariables,
  command: string
): { program: string; args: string[] } {
  switch (platform) {
    case "darwin": {
      return {
        program: "sandbox-exec",
        args: [
          "-p",
          seatbeltProfile(rules, hasNetwork),
          ...sandboxParams(rules),
          "/bin/sh",
          "-c",
          'mkdir -p "$1" 2>/dev/null; cd "$0" && TMPDIR="$1" exec /bin/sh -c "$2"',
          project,
          tmp,
          command,
        ],
      };
    }
    default: {
      throw new Error(`sandboxed shell is not implemented on ${platform}`);
    }
  }
}

async function timed(run: () => Promise<ShellResult>): Promise<string> {
  const start = performance.now();
  const { stdout, stderr, code } = await run();
  return formatShellResult(stdout, stderr, code, performance.now() - start);
}

export function createShellTools(
  runtime: Runtime,
  workspaceDir: string,
  executionMode: ExecutionModeSource = DEFAULT_EXECUTION_MODE,
  options: AgentToolOptions = {}
) {
  const runSandboxed = async (level: SandboxLevel, command: string) => {
    const variables = await sandboxVariables(runtime, workspaceDir);
    const settings = await resolveSettings(runtime, workspaceDir, options.sessionId);
    const rules = sandboxRules(settings.sandbox, level, variables);
    const { program, args } = sandboxInvocation(
      runtime.platform,
      rules,
      settings.networkAccess,
      variables,
      command
    );
    return timed(() => runtime.shell.execute(program, args));
  };

  const runUnsandboxed = async (command: string) => {
    const workdir = await runtime.paths.resolve(workspaceDir);
    return timed(() =>
      runtime.shell.execute("sh", ["-c", 'cd "$0" && exec /bin/sh -c "$1"', workdir, command])
    );
  };

  const shellTool = (level: AccessLevel, spec: typeof TOOL_SPECS.shellReadOnly) =>
    tool(async ({ command }: { command: string }, config) => {
      try {
        const mode = await currentMode(executionMode);
        const prompt = {
          kind: "confirm" as const,
          label: command,
          mode: LEVEL_MODES[level],
          currentMode: mode,
        };
        if (requiresApproval(level, mode) && !(await isConfirmedByUser(config, prompt)))
          return createRejectedResult(spec.name, prompt);
        return level === 4 ? await runUnsandboxed(command) : await runSandboxed(level, command);
      } catch (error: unknown) {
        rethrowIfFatal(error);
        const message = error instanceof Error ? error.message : String(error);
        return `Error executing command "${command}": ${message}`;
      }
    }, spec);

  return [
    shellTool(1, TOOL_SPECS.shellProjectReadOnly),
    shellTool(2, TOOL_SPECS.shellReadOnly),
    shellTool(3, TOOL_SPECS.shellProjectWrite),
    shellTool(4, TOOL_SPECS.shellFullAccess),
  ];
}
