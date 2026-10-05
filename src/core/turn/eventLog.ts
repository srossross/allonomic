import {
  isOpEvent,
  WORKER_ACTOR,
  type ScopeOptions,
  type ScopedSink,
  type TurnEvent,
  type TurnEventBody,
  type TurnEventListener,
  type TurnEventSink,
  type TurnSegment,
} from "./events";

export type SegmentListener = (segment: TurnSegment) => void;

export interface TurnEventLog {
  sink: TurnEventSink;
  events: TurnEvent[];
  closeOpenScopes(): void;
}

export function createTurnEventLog(
  turnIndex: number,
  listeners: TurnEventListener[],
  onSegment: SegmentListener = () => {}
): TurnEventLog {
  const events: TurnEvent[] = [];
  const open = new Set<ScopedSink>();

  const record = (body: TurnEventBody, actor: string): TurnEvent => {
    const event: TurnEvent = {
      ...body,
      seq: events.length,
      at: new Date().toISOString(),
      turnIndex,
      actor,
    };
    events.push(event);
    for (const listener of listeners) listener(event);
    return event;
  };

  const createScope = (
    parent: TurnEventSink,
    adoptIntoParent: (adopted: TurnEvent[]) => void,
    name: string,
    { phase, toolCallId }: ScopeOptions = {}
  ): ScopedSink => {
    const actor = phase ? `${name}-${phase}` : name;
    const buffered: TurnEvent[] = [];
    const startedAt = Date.now();
    let isClosed = false;
    const adopt = (adopted: TurnEvent[]) => {
      buffered.push(...adopted);
    };
    const scoped: ScopedSink = {
      emit(body) {
        if (isClosed) throw new Error(`${actor} emitted ${body.type} after its scope closed`);
        buffered.push(record(body, actor));
      },
      scope: (childName, options) => createScope(scoped, adopt, childName, options),
      close({ collapse = false } = {}) {
        if (isClosed) return;
        isClosed = true;
        open.delete(scoped);
        if (collapse && buffered.every((event) => !isOpEvent(event))) {
          const usage = buffered.filter((event) => event.type === "model_usage");
          if (usage.length > 0) adoptIntoParent(usage);
          parent.emit({
            type: "interceptor_passed",
            interceptor: name,
            phase: phase ?? "",
            toolCallId,
            durationMs: Date.now() - startedAt,
          });
        } else {
          onSegment({ actor, isScope: true, events: buffered });
        }
      },
    };
    open.add(scoped);
    return scoped;
  };

  const sink: TurnEventSink = {
    emit(body) {
      onSegment({ actor: WORKER_ACTOR, isScope: false, events: [record(body, WORKER_ACTOR)] });
    },
    scope: (name, options) =>
      createScope(
        sink,
        (adopted) => onSegment({ actor: WORKER_ACTOR, isScope: false, events: adopted }),
        name,
        options
      ),
  };

  return {
    sink,
    events,
    closeOpenScopes() {
      for (const scoped of open) scoped.close();
    },
  };
}

export function countRetries(events: TurnEvent[]): number {
  return events.filter((event) => event.type === "exit_retry").length;
}
