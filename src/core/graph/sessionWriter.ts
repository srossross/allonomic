import { createLogger } from "../log";
import type { FileStore } from "../ports";
import { appendTraceLog, saveTurnEvents } from "../telemetry/session";
import type { TurnEvent } from "../turn/events";
import { formatTraceLine } from "../turn/trace";

const log = createLogger("pipeline/sessionWriter");

export class SessionWriter {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly fs: FileStore,
    private readonly sessionDir: () => string
  ) {}

  private enqueue(write: () => Promise<void>) {
    const previous = this.queue;
    this.queue = (async () => {
      await previous;
      await write();
    })();
  }

  record(turnIndex: number, event: TurnEvent, events: TurnEvent[]) {
    const line = formatTraceLine(event);
    const snapshot = [...events];
    this.enqueue(() => appendTraceLog(this.fs, this.sessionDir(), line));
    this.enqueue(async () => {
      try {
        await saveTurnEvents(this.fs, this.sessionDir(), turnIndex, snapshot);
      } catch (error: unknown) {
        log.error("saveTurnEvents:failed", {
          turnIndex,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }
}
