import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export function createShellTools(workspaceDir: string = process.cwd(), isDryRun: boolean = false) {
  const runCommand = tool(
    async ({ command }) => {
      if (isDryRun) {
        return `[DRY-RUN / ECHO]: Would execute command: "${command}" in ${workspaceDir}`;
      }
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: workspaceDir,
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
      name: "run_command",
      description: "Execute a shell command in the workspace.",
      schema: z.object({
        command: z.string().describe("Shell command to run (e.g. 'bun test', 'git status')"),
      }),
    }
  );

  return [runCommand];
}
