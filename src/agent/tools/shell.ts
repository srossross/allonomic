import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ExecutionMode } from "@/types";

import fs from "node:fs";
import path from "node:path";

const execAsync = promisify(exec);

function findDevContainerRoot(startDir: string): string {
  let currentDir = path.resolve(startDir);
  while (currentDir !== path.parse(currentDir).root) {
    if (fs.existsSync(path.join(currentDir, ".devcontainer"))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  return path.resolve(startDir);
}

async function getActiveContainerId(workspaceDir: string): Promise<string> {
  try {
    const rootDir = findDevContainerRoot(workspaceDir);
    const { stdout } = await execAsync(`docker ps -q -f "label=devcontainer.local_folder=${rootDir}"`);
    const [containerId] = stdout.trim().split("\n", 1);
    if (!containerId) {
      throw new Error("Dev container not found");
    }
    return containerId;
  } catch {
    throw new Error("SECURITY EXCEPTION: Dev container is not running. Host execution is strictly disabled.");
  }
}

export function createShellTools(workspaceDir: string = process.cwd(), executionMode: ExecutionMode = "manual") {
  const runReadOnlyCommand = tool(
    async ({ command }) => {
      try {
        const containerId = await getActiveContainerId(workspaceDir);
        // Escape single quotes for the outer sh -c single-quoted string
        const escapedCommand = JSON.stringify(command).replace(/'/g, "'\\''");
        // We must run bwrap inside `sh -c` inside the container so that $PWD is evaluated to the container's working directory, not the host's.
        const finalCommand = `docker exec ${containerId} sh -c 'bwrap --bind / / --dev-bind /dev /dev --ro-bind "$PWD" "$PWD" sh -c ${escapedCommand}'`;
        
        const { stdout, stderr } = await execAsync(finalCommand, {
          maxBuffer: 100 * 1024 * 1024,
          timeout: 300_000,
        });
        const out = stdout ? stdout.trim() : "";
        const error = stderr ? stderr.trim() : "";
        if (error && out) return `${out}\n[STDERR]:\n${error}`;
        return error ? `[STDERR]:\n${error}` : out || "(command completed with no output)";
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const stdout =
          error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
        const stderr =
          error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
        return `Error executing command "${command}": ${message}${stdout ? `\nStdout: ${stdout}` : ""}${stderr ? `\nStderr: ${stderr}` : ""}`;
      }
    },
    {
      name: "run_read_only_command",
      description: "Execute a strictly read-only shell command inside the devcontainer sandbox (using bwrap). Will fail if it attempts to mutate files.",
      schema: z.object({
        command: z.string().describe("The read-only shell command to execute"),
      }),
    }
  );

  const runMutatingCommand = tool(
    async ({ command }) => {
      try {
        const containerId = await getActiveContainerId(workspaceDir);

        if (executionMode === "manual") {
          return `[PENDING_APPROVAL]: Executing mutating command requires user approval in Manual mode. The command was NOT run yet. Changes are staged and paused pending user approval.`;
        }
        
        const escapedCommand = JSON.stringify(command).replace(/'/g, "'\\''");
        const finalCommand = `docker exec ${containerId} sh -c '${escapedCommand}'`;
        
        const { stdout, stderr } = await execAsync(finalCommand, {
          maxBuffer: 100 * 1024 * 1024,
          timeout: 300_000,
        });
        const out = stdout ? stdout.trim() : "";
        const error = stderr ? stderr.trim() : "";
        if (error && out) return `${out}\n[STDERR]:\n${error}`;
        return error ? `[STDERR]:\n${error}` : out || "(command completed with no output)";
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const stdout =
          error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
        const stderr =
          error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
        return `Error executing command "${command}": ${message}${stdout ? `\nStdout: ${stdout}` : ""}${stderr ? `\nStderr: ${stderr}` : ""}`;
      }
    },
    {
      name: "run_mutating_command",
      description: "Execute a shell command that may mutate files or state. Requires user approval in manual mode.",
      schema: z.object({
        command: z.string().describe("The shell command to execute"),
      }),
    }
  );

  return [runReadOnlyCommand, runMutatingCommand];
}
