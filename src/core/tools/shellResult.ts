const FOOTER = /^([\s\S]*?)\n?\[exit (-?\d+|killed) in (\d+)ms\](?=$|\n\n\[)/;

export interface ParsedShellResult {
  output: string;
  exitCode?: number | "killed";
  durationMs?: number;
}

export function formatShellResult(
  stdout: string,
  stderr: string,
  exitCode: number | null,
  durationMs: number
): string {
  const out = stdout ? stdout.trim() : "";
  const error = stderr ? stderr.trim() : "";
  const body =
    error && out
      ? `${out}\n[STDERR]:\n${error}`
      : error
        ? `[STDERR]:\n${error}`
        : out || "(command completed with no output)";
  return `${body}\n[exit ${exitCode ?? "killed"} in ${Math.round(durationMs)}ms]`;
}

export function parseShellResult(content: string): ParsedShellResult {
  const match = FOOTER.exec(content);
  if (!match) return { output: content };
  return {
    output: match[1] + content.slice(match[0].length),
    exitCode: match[2] === "killed" ? "killed" : Number(match[2]),
    durationMs: Number(match[3]),
  };
}
