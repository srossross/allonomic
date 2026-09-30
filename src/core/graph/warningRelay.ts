import type { TurnEventBody, TurnEventSink } from "../turn/events";

export class WarningRelay {
  private sink?: TurnEventSink;
  private pending: TurnEventBody[] = [];

  warn = (source: string, error: unknown) => {
    const body: TurnEventBody = {
      type: "warning",
      source,
      message: error instanceof Error ? error.message : String(error),
    };
    if (this.sink) this.sink.emit(body);
    else this.pending.push(body);
  };

  attach(sink: TurnEventSink) {
    this.sink = sink;
    for (const body of this.pending.splice(0)) sink.emit(body);
  }

  detach(sink: TurnEventSink) {
    if (this.sink === sink) this.sink = undefined;
  }
}
