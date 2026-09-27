import { createLogger } from "../log";
import type { TurnEvent, TurnEventListener, TurnEventSink } from "./events";

const log = createLogger("turn/eventLog");

export interface TurnEventLog {
  sink: TurnEventSink;
  events: TurnEvent[];
}

export function createTurnEventLog(
  turnIndex: number,
  listeners: TurnEventListener[]
): TurnEventLog {
  const events: TurnEvent[] = [];
  const sink: TurnEventSink = {
    emit(body) {
      const event: TurnEvent = {
        ...body,
        seq: events.length,
        at: new Date().toISOString(),
        turnIndex,
      };
      events.push(event);
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          log.error("listener:failed", {
            type: event.type,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
  };
  return { sink, events };
}

export function countRetries(events: TurnEvent[]): number {
  return events.filter((event) => event.type === "exit_retry").length;
}
