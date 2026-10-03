import type { Shell, ShellOptions, ShellProcess, ShellResult, ShellTermination } from "./ports";

export const KILL_GRACE_MS = 2000;

export const WATCH_GROUP = `( while kill -0 "$p" && kill -0 -- "-$g"; do sleep 1; done; kill -TERM -- "-$g" ) </dev/null >/dev/null 2>&1 &`;

export const PARENT_WATCHDOG = `p=$PPID; g=$0; ${WATCH_GROUP}`;

export const PGID_MARKER = "@@allonomic-pgid:";

export const GROUP_WRAPPER = String.raw`exec 3>&2 2>/dev/null; set -m; "$@" 2>&3 3>&- & g=$!; p=$PPID; printf '${PGID_MARKER}%s\n' "$g" >&3; ${WATCH_GROUP} wait "$g"`;

function whenAborted(signal: AbortSignal): Promise<null> {
  return new Promise((resolve) =>
    signal.addEventListener("abort", () => resolve(null), { once: true })
  );
}

async function didSettleWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), ms);
  const settled = async () => {
    await promise;
    return true;
  };
  try {
    return (await Promise.race([settled(), whenAborted(timeout.signal)])) === true;
  } finally {
    clearTimeout(timer);
  }
}

export async function terminateProcess(process: ShellProcess): Promise<void> {
  await process.kill("SIGTERM");
  if (await didSettleWithin(process.exited, KILL_GRACE_MS)) return;
  await process.kill("SIGKILL");
  await didSettleWithin(process.exited, KILL_GRACE_MS);
}

export type ProcessOutput = () => { stdout: string; stderr: string };

export async function superviseProcess(
  process: ShellProcess,
  output: ProcessOutput,
  options: ShellOptions
): Promise<ShellResult> {
  const never = new AbortController().signal;
  const result = await superviseDetachable(process, output, options, never);
  if (!result) throw new Error("process detached without a detach signal");
  return result;
}

export async function superviseDetachable(
  process: ShellProcess,
  output: ProcessOutput,
  { timeoutMs, signal }: ShellOptions,
  detach: AbortSignal
): Promise<ShellResult | undefined> {
  let termination: ShellTermination | undefined;
  const terminated = new AbortController();
  const terminate = (reason: ShellTermination) => {
    if (termination) return;
    termination = reason;
    void (async () => {
      await terminateProcess(process);
      terminated.abort();
    })();
  };
  const onAbort = () => terminate("stopped");

  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const timer = timeoutMs ? setTimeout(() => terminate("timeout"), timeoutMs) : undefined;

  try {
    const code = await Promise.race([
      process.exited,
      whenAborted(terminated.signal),
      whenAborted(detach),
    ]);
    if (!termination && detach.aborted) return undefined;
    return { code: termination ? null : code, ...output(), termination };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function executeBySpawn(
  spawn: Shell["spawn"],
  program: string,
  args: string[],
  options: ShellOptions = {}
): Promise<ShellResult> {
  let stdout = "";
  let stderr = "";
  const process = await spawn(program, args, {
    cwd: options.cwd,
    onOutput: (stream, text) => {
      if (stream === "stdout") stdout += text;
      else stderr += text;
    },
  });
  return superviseProcess(process, () => ({ stdout, stderr }), options);
}
