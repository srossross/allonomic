import type { LogRecord } from "../log";
import { join } from "../paths";
import type { FileStore } from "../ports";
import { appendTraceLog, saveTurnEvents } from "../telemetry/session";
import type { TurnEvent } from "../turn/events";
import { formatTraceLine } from "../turn/trace";

export const SESSION_LOG_FILE = "session.log";

export type WriteWarning = (source: string, error: unknown) => void;

export class SessionWriter {
  private queue: Promise<void> = Promise.resolve();
  private failure: { error: unknown } | undefined;
  private warned = new Set<string>();

  constructor(
    private readonly fs: FileStore,
    private readonly sessionDir: () => string,
    private readonly onWarning: WriteWarning
  ) {}

  private enqueue(write: () => Promise<void>) {
    const previous = this.queue;
    this.queue = (async () => {
      await previous;
      await write();
    })();
    void this.trackFailure(this.queue);
  }

  private async trackFailure(write: Promise<void>) {
    try {
      await write;
    } catch (error) {
      this.failure ??= { error };
    }
  }

  private enqueueLog(source: string, write: () => Promise<void>) {
    this.enqueue(async () => {
      try {
        await write();
      } catch (error) {
        if (this.warned.has(source)) return;
        this.warned.add(source);
        this.onWarning(source, error);
      }
    });
  }

  flush(): Promise<void> {
    return this.queue;
  }

  record(turnIndex: number, event: TurnEvent, events: TurnEvent[]) {
    if (this.failure) throw this.failure.error;
    const line = formatTraceLine(event);
    const snapshot = [...events];
    this.enqueueLog("trace.log", () => appendTraceLog(this.fs, this.sessionDir(), line));
    this.enqueue(() => saveTurnEvents(this.fs, this.sessionDir(), turnIndex, snapshot));
  }

  appendLog(record: LogRecord) {
    const line = `${JSON.stringify(record)}\n`;
    this.enqueueLog(SESSION_LOG_FILE, async () => {
      const dir = this.sessionDir();
      await this.fs.mkdir(dir);
      await this.fs.writeText(join(dir, SESSION_LOG_FILE), line, { append: true });
    });
  }
}
