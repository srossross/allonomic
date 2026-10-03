import type { FileStore } from "../../src/core/ports";
import { SessionWriter } from "../../src/core/graph/sessionWriter";
import { createTurnEventLog } from "../../src/core/turn/eventLog";
import type { TurnEvent, TurnEventSink } from "../../src/core/turn/events";

export async function writeTurn(
  fs: FileStore,
  sessionDir: string,
  turnIndex: number,
  build: (sink: TurnEventSink) => void
): Promise<TurnEvent[]> {
  const writer = new SessionWriter(
    fs,
    () => sessionDir,
    () => {}
  );
  const { sink, events } = createTurnEventLog(turnIndex, [], (segment) =>
    writer.commit(turnIndex, segment)
  );
  build(sink);
  await writer.flush();
  return events;
}
