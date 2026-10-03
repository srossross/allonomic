import { tool } from "@langchain/core/tools";
import { rethrowIfFatal } from "./fatal";
import { DEFAULT_EXECUTION_MODE, LEVEL_MODES, type AccessLevel } from "@/types";
import type { Runtime } from "../ports";
import { createRejectedResult } from "../userPrompt";
import type { AgentToolOptions } from "./index";
import {
  currentMode,
  isConfirmedByUser,
  requiresApproval,
  type ExecutionModeSource,
} from "./approval";
import { TOOL_SPECS } from "./specs";
import { formatBackgroundedResult, formatShellResult } from "./shellResult";
import { ToolStops, type TrackedToolCall } from "./toolStops";
import { superviseDetachable } from "../superviseProcess";
import { createJobTools, startBackgroundJob } from "./jobTools";
import { BackgroundJobs, type JobLauncher, type JobSpec } from "../jobs/backgroundJobs";
import { readToolCallId } from "../graph/types";
import { resolveSettings } from "../config/settings";
import { join } from "../paths";
import {
  SANDBOX_TMP_ROOT,
  sandboxRules,
  sandboxVariables,
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
  { tmp }: SandboxVariables,
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
          'mkdir -p "$0" 2>/dev/null; TMPDIR="$0" exec /bin/sh -c "$1"',
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

export function createShellLauncher(
  runtime: Runtime,
  workspaceDir: string,
  sessionId?: string
): JobLauncher {
  return async ({ level, command }) => {
    const settings = await resolveSettings(runtime, workspaceDir, sessionId);
    const variables = await sandboxVariables(runtime, workspaceDir);
    const logDir = join(variables.tmp, "jobs", sessionId ?? "default");
    if (level === 4)
      return { program: "sh", args: ["-c", command], cwd: variables.project, logDir };
    const rules = sandboxRules(settings.sandbox, level, variables);
    const { program, args } = sandboxInvocation(
      runtime.platform,
      rules,
      settings.networkAccess,
      variables,
      command
    );
    return { program, args, cwd: variables.project, logDir };
  };
}

interface ShellToolInput {
  command: string;
  background?: boolean;
  wait_for?: string;
}

export function createShellTools(
  runtime: Runtime,
  workspaceDir: string,
  executionMode: ExecutionModeSource = DEFAULT_EXECUTION_MODE,
  options: AgentToolOptions = {}
) {
  const stops = options.stops ?? new ToolStops();
  const launch = createShellLauncher(runtime, workspaceDir, options.sessionId);
  const jobs = options.jobs ?? new BackgroundJobs(runtime.shell, runtime.fs, launch);

  const run = async (spec: JobSpec, tracked: TrackedToolCall) => {
    const settings = await resolveSettings(runtime, workspaceDir, options.sessionId);
    const { program, args, cwd, logDir } = await launch(spec);
    const start = performance.now();
    let stdout = "";
    let stderr = "";
    const adopted: { append?: (text: string) => void } = {};
    const process = await runtime.shell.spawn(program, args, {
      cwd,
      onOutput: (stream, text) => {
        if (adopted.append) adopted.append(text);
        else if (stream === "stdout") stdout += text;
        else stderr += text;
      },
    });
    const result = await superviseDetachable(
      process,
      () => ({ stdout, stderr }),
      { signal: tracked.signal, timeoutMs: settings.shellTimeoutSeconds * 1000 },
      tracked.background
    );
    const durationMs = performance.now() - start;
    if (result)
      return formatShellResult(
        result.stdout,
        result.stderr,
        result.code,
        durationMs,
        result.termination
      );
    const job = jobs.adopt(spec, process, stdout + stderr, logDir);
    adopted.append = job.append;
    await jobs.flushLog(job.info.id);
    return formatBackgroundedResult(stdout, stderr, job.info, durationMs);
  };

  const shellTool = (level: AccessLevel, spec: typeof TOOL_SPECS.shellReadOnly) =>
    tool(async ({ command, background, wait_for }: ShellToolInput, config) => {
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
        const jobSpec = { command, level, toolName: spec.name };
        if (background) return await startBackgroundJob(jobs, jobSpec, wait_for);
        const tracked = stops.track(readToolCallId(config), config.signal);
        try {
          return await run(jobSpec, tracked);
        } finally {
          tracked.end();
        }
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
    ...createJobTools(jobs),
  ];
}
