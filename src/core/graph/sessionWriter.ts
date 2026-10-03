import type { LogRecord } from "../log";
import { join } from "../paths";
import type { FileStore } from "../ports";
import type { TurnSegment } from "../turn/events";
import { appendSegmentEvents, segmentFileName, turnDirFor } from "../turn/turnFiles";

export const SESSION_LOG_FILE = "logs/app.log";

export type WriteWarning = (source: string, error: unknown) => void;

interface TurnCursor {
  turnIndex: number;
  position: number;
  current?: { actor: string; isScope: boolean; path: string };
}

export class SessionWriter {
  private queue: Promise<void> = Promise.resolve();
  private failure: { error: unknown } | undefined;
  private warned = new Set<string>();
  private cursor: TurnCursor | undefined;

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

  private continuation(cursor: TurnCursor, segment: TurnSegment) {
    const { current } = cursor;
    return current && !segment.isScope && !current.isScope && current.actor === segment.actor
      ? current
      : undefined;
  }

  private openSegment(cursor: TurnCursor, segment: TurnSegment) {
    cursor.position++;
    const turnDir = turnDirFor(this.sessionDir(), cursor.turnIndex);
    cursor.current = {
      actor: segment.actor,
      isScope: segment.isScope,
      path: join(turnDir, segmentFileName(cursor.position, segment.actor)),
    };
    this.enqueue(() => this.fs.mkdir(turnDir));
    return cursor.current;
  }

  flush(): Promise<void> {
    return this.queue;
  }

  commit(turnIndex: number, segment: TurnSegment) {
    if (this.failure) throw this.failure.error;
    if (segment.events.length === 0) return;
    if (this.cursor?.turnIndex !== turnIndex) this.cursor = { turnIndex, position: 0 };
    const target =
      this.continuation(this.cursor, segment) ?? this.openSegment(this.cursor, segment);
    const { events } = segment;
    this.enqueue(() => appendSegmentEvents(this.fs, target.path, events));
  }

  appendLog(record: LogRecord) {
    const line = `${JSON.stringify(record)}\n`;
    this.enqueueLog(SESSION_LOG_FILE, async () => {
      const path = join(this.sessionDir(), SESSION_LOG_FILE);
      await this.fs.mkdir(join(this.sessionDir(), "logs"));
      await this.fs.writeText(path, line, { append: true });
    });
  }
}
