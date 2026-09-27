import { tool } from "@langchain/core/tools";
import type { ExecutionMode } from "@/types";
import type { Runtime, ShellResult } from "../ports";
import { resolveDevContainer, invalidateDevContainer, ensureContainer } from "../devcontainer";
import { createPendingResult } from "../userPrompt";
import type { AgentToolOptions } from "./index";
import { TOOL_SPECS } from "./specs";

const NOT_RUNNING =
  "SECURITY EXCEPTION: Dev container is not running. Host execution is strictly disabled.";

const SEATBELT_READ_ONLY = `(version 1)
(allow default)
(deny file-write*)
(allow file-write*
  (literal "/dev/null")
  (literal "/dev/stdout")
  (literal "/dev/stderr")
  (literal "/dev/tty")
  (literal "/dev/dtracehelper"))`;

function nativeReadOnlyInvocation(
  platform: string,
  workdir: string,
  command: string
): { program: string; args: string[] } {
  switch (platform) {
    case "darwin": {
      return {
        program: "sandbox-exec",
        args: [
          "-p",
          SEATBELT_READ_ONLY,
          "/bin/sh",
          "-c",
          'cd "$0" && /bin/sh -c "$1"',
          workdir,
          command,
        ],
      };
    }
    default: {
      throw new Error(`run_native_read_only_command is not implemented on ${platform}`);
    }
  }
}

function formatOutput(stdout: string, stderr: string): string {
  const out = stdout ? stdout.trim() : "";
  const error = stderr ? stderr.trim() : "";
  if (error && out) return `${out}\n[STDERR]:\n${error}`;
  return error ? `[STDERR]:\n${error}` : out || "(command completed with no output)";
}

function isStaleContainer(result: ShellResult): boolean {
  return result.code !== 0 && /No such container|is not running/i.test(result.stderr);
}

async function resolveRunning(runtime: Runtime, workspaceDir: string) {
  const dc = await resolveDevContainer(runtime, workspaceDir);
  if (dc.status === "running") return dc;
  await ensureContainer(runtime, workspaceDir);
  return resolveDevContainer(runtime, workspaceDir);
}

async function execInContainer(
  runtime: Runtime,
  workspaceDir: string,
  buildArgs: (containerId: string, workdir: string) => string[]
): Promise<ShellResult> {
  const run = async () => {
    const dc = await resolveRunning(runtime, workspaceDir);
    if (dc.status !== "running" || !dc.containerId || !dc.workdir) throw new Error(NOT_RUNNING);
    return runtime.shell.execute("docker", [
      "exec",
      "-w",
      dc.workdir,
      dc.containerId,
      ...buildArgs(dc.containerId, dc.workdir),
    ]);
  };
  const first = await run();
  if (!isStaleContainer(first)) return first;
  await invalidateDevContainer(runtime, workspaceDir);
  return run();
}

export function createShellTools(
  runtime: Runtime,
  workspaceDir: string,
  executionMode: ExecutionMode = "manual",
  options: AgentToolOptions = {}
) {
  const runReadOnlyCommand = tool(async ({ command }) => {
    try {
      const { stdout, stderr } = await execInContainer(runtime, workspaceDir, (_, workdir) => [
        "bwrap",
        "--bind",
        "/",
        "/",
        "--dev-bind",
        "/dev",
        "/dev",
        "--ro-bind",
        workdir,
        workdir,
        "sh",
        "-c",
        command,
      ]);
      return formatOutput(stdout, stderr);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error executing command "${command}": ${message}`;
    }
  }, TOOL_SPECS.runReadOnlyCommand);

  const runMutatingCommand = tool(async ({ command }) => {
    try {
      if (executionMode === "manual" && !options.approved) {
        const dc = await resolveRunning(runtime, workspaceDir);
        if (dc.status !== "running") throw new Error(NOT_RUNNING);
        return createPendingResult({ kind: "confirm", label: command });
      }
      const { stdout, stderr } = await execInContainer(runtime, workspaceDir, () => [
        "sh",
        "-c",
        command,
      ]);
      return formatOutput(stdout, stderr);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error executing command "${command}": ${message}`;
    }
  }, TOOL_SPECS.runMutatingCommand);

  const runNativeReadOnlyCommand = tool(async ({ command }) => {
    const workdir = await runtime.paths.resolve(workspaceDir);
    const { program, args } = nativeReadOnlyInvocation(runtime.platform, workdir, command);
    if (!options.approved) return createPendingResult({ kind: "confirm", label: command });
    try {
      const { stdout, stderr } = await runtime.shell.execute(program, args);
      return formatOutput(stdout, stderr);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error executing command "${command}": ${message}`;
    }
  }, TOOL_SPECS.runNativeReadOnlyCommand);

  return [runReadOnlyCommand, runMutatingCommand, runNativeReadOnlyCommand];
}
