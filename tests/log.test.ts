import { describe, it, expect, afterEach } from "bun:test";
import { MemoryFileStore } from "../src/adapters/memory/runtime";
import { SESSION_LOG_FILE, SessionWriter } from "../src/core/graph/sessionWriter";
import {
  createLogger,
  formatRecord,
  registerSessionSink,
  setAppSink,
  type LogRecord,
} from "../src/core/log";

function collectSession(sessionId: string, into: LogRecord[]) {
  return registerSessionSink(sessionId, (record) => {
    into.push(record);
  });
}

describe("log routing", () => {
  const app: LogRecord[] = [];
  const cleanups: (() => void)[] = [];

  setAppSink((record) => {
    app.push(record);
  });

  afterEach(() => {
    app.length = 0;
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("sends session-bound records to the app sink and the matching session sink", () => {
    const session: LogRecord[] = [];
    cleanups.push(collectSession("s1", session));

    createLogger("test").child({ sessionId: "s1" }).info({ turnIndex: 2 }, "hello");

    expect(app).toHaveLength(1);
    expect(session).toHaveLength(1);
    expect(session[0]).toMatchObject({
      level: 30,
      scope: "test",
      sessionId: "s1",
      turnIndex: 2,
      msg: "hello",
    });
  });

  it("does not route records without a matching session", () => {
    const session: LogRecord[] = [];
    cleanups.push(collectSession("s1", session));

    createLogger("test").info("app only");
    createLogger("test").child({ sessionId: "other" }).info("other session");

    expect(app).toHaveLength(2);
    expect(session).toHaveLength(0);
  });

  it("formats records as a scoped line", () => {
    expect(formatRecord({ level: 30, time: 0, scope: "a", msg: "m", x: 1 })).toBe('[a] m {"x":1}');
  });
});

describe("SessionWriter.appendLog", () => {
  it("appends JSONL records to session.log", async () => {
    const fs = new MemoryFileStore();
    const writer = new SessionWriter(
      fs,
      () => "/ws/.allonomic/sessions/s1",
      () => {}
    );

    writer.appendLog({ level: 30, time: 1, msg: "one" });
    writer.appendLog({ level: 40, time: 2, msg: "two" });
    await writer.flush();

    const content = await fs.readText(`/ws/.allonomic/sessions/s1/${SESSION_LOG_FILE}`);
    const lines = content
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines).toEqual([
      { level: 30, time: 1, msg: "one" },
      { level: 40, time: 2, msg: "two" },
    ]);
  });
});
