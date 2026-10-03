import type { ShellTermination } from "../ports";

const FOOTER =
  /^([\s\S]*?)\n?\[(?:exit (-?\d+|killed)|(stopped by user|timed out|moved to background as job-\d+)) in (\d+)ms(?:; output in [^\]\n]+)?\](?=$|\n\n\[)/;

const TERMINATION_LABELS: Record<ShellTermination, string> = {
  stopped: "stopped by user",
  timeout: "timed out",
};

const BACKGROUND_LABEL = "moved to background as ";

export interface ParsedShellResult {
  output: string;
  exitCode?: number | "killed" | "background" | ShellTermination;
  durationMs?: number;
}

function shellBody(stdout: string, stderr: string) {
  const out = stdout ? stdout.trim() : "";
  const error = stderr ? stderr.trim() : "";
  if (error && out) return `${out}\n[STDERR]:\n${error}`;
  return error ? `[STDERR]:\n${error}` : out || "(command completed with no output)";
}

export function formatShellResult(
  stdout: string,
  stderr: string,
  exitCode: number | null,
  durationMs: number,
  termination?: ShellTermination
): string {
  const status = termination ? TERMINATION_LABELS[termination] : `exit ${exitCode ?? "killed"}`;
  return `${shellBody(stdout, stderr)}\n[${status} in ${Math.round(durationMs)}ms]`;
}

export function formatBackgroundedResult(
  stdout: string,
  stderr: string,
  { id, logPath }: { id: string; logPath: string },
  durationMs: number
): string {
  return `${shellBody(stdout, stderr)}\n[${BACKGROUND_LABEL}${id} in ${Math.round(durationMs)}ms; output in ${logPath}]`;
}

function parseExitCode(code: string | undefined, label: string | undefined) {
  if (label === TERMINATION_LABELS.stopped) return "stopped";
  if (label === TERMINATION_LABELS.timeout) return "timeout";
  if (label?.startsWith(BACKGROUND_LABEL)) return "background";
  return code === "killed" ? "killed" : Number(code);
}

export function parseShellResult(content: string): ParsedShellResult {
  const match = FOOTER.exec(content);
  if (!match) return { output: content };
  return {
    output: match[1] + content.slice(match[0].length),
    exitCode: parseExitCode(match[2], match[3]),
    durationMs: Number(match[4]),
  };
}
