import pino from "pino/browser.js";

export type Logger = pino.Logger;

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LogRecord {
  level: number;
  time: number;
  msg?: string;
  scope?: string;
  sessionId?: string;
  [key: string]: unknown;
}

export type LogSink = (record: LogRecord) => void;

const LEVEL_NAMES: Record<number, LogLevel> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

export function levelName(level: number): LogLevel {
  return LEVEL_NAMES[level] ?? "info";
}

export function formatRecord(record: LogRecord): string {
  const { level: _level, time: _time, msg, scope, ...rest } = record;
  const prefix = scope ? `[${scope}] ` : "";
  const data = Object.keys(rest).length > 0 ? ` ${safeStringify(rest)}` : "";
  return `${prefix}${msg ?? ""}${data}`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const CONSOLE_METHODS: Record<LogLevel, "debug" | "info" | "warn" | "error"> = {
  trace: "debug",
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
  fatal: "error",
};

const state: { app: LogSink; sessions: Map<string, LogSink> } = {
  app: (record) => console[CONSOLE_METHODS[levelName(record.level)]](formatRecord(record)),
  sessions: new Map(),
};

export function setAppSink(sink: LogSink): void {
  state.app = sink;
}

export function registerSessionSink(sessionId: string, sink: LogSink): () => void {
  state.sessions.set(sessionId, sink);
  return () => {
    if (state.sessions.get(sessionId) === sink) state.sessions.delete(sessionId);
  };
}

function isLogRecord(o: object): o is LogRecord {
  return "level" in o && typeof o.level === "number";
}

function dispatch(o: object): void {
  if (!isLogRecord(o)) return;
  state.app(o);
  if (o.sessionId) state.sessions.get(o.sessionId)?.(o);
}

const root = pino({ level: "debug", browser: { asObject: true, write: dispatch } });

export function createLogger(scope: string): Logger {
  return root.child({ scope });
}
