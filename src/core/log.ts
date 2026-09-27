export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogSink = (level: LogLevel, message: string) => void;

const state: { sink: LogSink } = { sink: (level, message) => console[level](message) };

export function setLogSink(next: LogSink): void {
  state.sink = next;
}

function fmt(scope: string, message: string, data?: unknown): string {
  if (data === undefined) return `[${scope}] ${message}`;
  let serialized: string;
  try {
    serialized = JSON.stringify(data);
  } catch {
    serialized = String(data);
  }
  return `[${scope}] ${message} ${serialized}`;
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, data?: unknown) => state.sink("debug", fmt(scope, message, data)),
    info: (message: string, data?: unknown) => state.sink("info", fmt(scope, message, data)),
    warn: (message: string, data?: unknown) => state.sink("warn", fmt(scope, message, data)),
    error: (message: string, data?: unknown) => state.sink("error", fmt(scope, message, data)),
  };
}
