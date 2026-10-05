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
import { createJobTools, formatJobFooter, startBackgroundJob } from "./jobTools";
import { BackgroundJobs, type JobLauncher, type JobSpec } from "../jobs/backgroundJobs";
import { findPipelineContext, readToolCallId } from "../graph/types";
import { createShellOutputs, selectLines, shellOutputPath, shellQuote } from "./shellOutput";
import { shellEnv } from "./shellEnv";
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
    const env = await shellEnv(runtime, settings.shellEnv);
    if (level === 4)
      return { program: "sh", args: ["-c", command], cwd: variables.project, logDir, env };
    const rules = sandboxRules(settings.sandbox, level, variables);
    const { program, args } = sandboxInvocation(
      runtime.platform,
      rules,
      settings.networkAccess,
      variables,
      command
    );
    return { program, args, cwd: variables.project, logDir, env };
  };
}

interface ShellToolInput {
  command: string;
  timeout?: number;
  background?: boolean;
  background_startup_ms?: number;
  query?: string;
}

interface ReadShellInput {
  call_id: string;
  query?: string;
  filter?: string;
  lines?: string;
}

interface StoredSource {
  command: string;
  path: string;
  content: string;
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
  const outputs = createShellOutputs(runtime, workspaceDir, {
    sessionId: options.sessionId,
    createReaderModel: options.createShellReaderModel,
  });
  let localCalls = 0;
  const callIdOf = (config: unknown) => readToolCallId(config) ?? `local-${++localCalls}`;

  const run = async (
    spec: JobSpec,
    tracked: TrackedToolCall,
    callId: string,
    timeoutSeconds?: number
  ) => {
    const settings = await resolveSettings(runtime, workspaceDir, options.sessionId);
    const { program, args, cwd, logDir, env } = await launch(spec);
    const start = performance.now();
    let stdout = "";
    let stderr = "";
    const adopted: { append?: (text: string) => void } = {};
    const process = await runtime.shell.spawn(program, args, {
      cwd,
      env,
      onOutput: (stream, text) => {
        if (adopted.append) adopted.append(text);
        else if (stream === "stdout") stdout += text;
        else stderr += text;
      },
    });
    const result = await superviseDetachable(
      process,
      () => ({ stdout, stderr }),
      {
        signal: tracked.signal,
        timeoutMs: (timeoutSeconds ?? settings.shellTimeoutSeconds) * 1000,
      },
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
    const job = jobs.adopt(spec, process, stdout + stderr, logDir, callId);
    adopted.append = job.append;
    await jobs.flushLog(job.info.id);
    return formatBackgroundedResult(stdout, stderr, job.info, durationMs);
  };

  const rejection = async (
    level: AccessLevel,
    label: string,
    toolName: string,
    config: unknown
  ) => {
    const mode = await currentMode(executionMode);
    const prompt = { kind: "confirm" as const, label, mode: LEVEL_MODES[level], currentMode: mode };
    return requiresApproval(level, mode) && !(await isConfirmedByUser(config, prompt))
      ? createRejectedResult(toolName, prompt)
      : null;
  };

  const shellTool = (level: AccessLevel, spec: typeof TOOL_SPECS.shellReadOnly) =>
    tool(async (input: ShellToolInput, config) => {
      const { command, timeout, background, background_startup_ms, query } = input;
      try {
        const rejected = await rejection(level, command, spec.name, config);
        if (rejected) return rejected;
        const callId = callIdOf(config);
        const events = findPipelineContext(config)?.events;
        const jobSpec = { command, level, toolName: spec.name };
        if (background) {
          const started = await startBackgroundJob(jobs, jobSpec, background_startup_ms, callId);
          return await outputs.present({
            callId,
            command,
            content: started.content,
            query,
            storedPath: started.logPath,
            events,
          });
        }
        const tracked = stops.track(readToolCallId(config), config.signal);
        try {
          const content = await run(jobSpec, tracked, callId, timeout);
          return await outputs.present({ callId, command, content, query, events });
        } finally {
          tracked.end();
        }
      } catch (error: unknown) {
        rethrowIfFatal(error);
        const message = error instanceof Error ? error.message : String(error);
        return `Error executing command "${command}": ${message}`;
      }
    }, spec);

  const storedSource = async (id: string): Promise<StoredSource | undefined> => {
    const job = jobs.findJob(id);
    if (job) {
      await jobs.flushLog(job.info.id);
      const log = await runtime.fs.readText(job.info.logPath);
      const footer = formatJobFooter(jobs.read(job.info.id)?.info ?? job.info);
      const content = `${log.replace(/\n$/, "")}\n${footer}`;
      return { command: job.info.command, path: job.info.logPath, content };
    }
    const path = await shellOutputPath(runtime, workspaceDir, options.sessionId, id);
    return (await runtime.fs.exists(path))
      ? { command: `output of ${id}`, path, content: await runtime.fs.readText(path) }
      : undefined;
  };

  const readShell = tool(async ({ call_id, query, filter, lines }: ReadShellInput, config) => {
    try {
      if ([query, filter, lines].filter((value) => value !== undefined).length > 1)
        return "Error: give at most one of query, filter or lines";
      const source = await storedSource(call_id);
      if (!source) return `Error: no stored output for ${call_id}`;
      const events = findPipelineContext(config)?.events;
      if (query !== undefined)
        return await outputs.query(source.command, query, source.content, events);
      if (lines !== undefined) return selectLines(source.content, lines);
      const callId = callIdOf(config);
      if (filter === undefined)
        return await outputs.present({
          callId,
          command: source.command,
          content: source.content,
          storedPath: source.path,
          events,
        });
      const command = `${filter} < ${shellQuote(source.path)}`;
      const rejected = await rejection(1, command, TOOL_SPECS.readShell.name, config);
      if (rejected) return rejected;
      const tracked = stops.track(readToolCallId(config), config.signal);
      try {
        const spec: JobSpec = { command, level: 1, toolName: TOOL_SPECS.readShell.name };
        const content = await run(spec, tracked, callId);
        return await outputs.present({ callId, command: filter, content, events });
      } finally {
        tracked.end();
      }
    } catch (error: unknown) {
      rethrowIfFatal(error);
      const message = error instanceof Error ? error.message : String(error);
      return `Error reading ${call_id}: ${message}`;
    }
  }, TOOL_SPECS.readShell);

  return [
    shellTool(1, TOOL_SPECS.shellProjectReadOnly),
    shellTool(2, TOOL_SPECS.shellReadOnly),
    shellTool(3, TOOL_SPECS.shellProjectWrite),
    shellTool(4, TOOL_SPECS.shellFullAccess),
    readShell,
    ...createJobTools(jobs),
  ];
}
