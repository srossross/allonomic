export interface TrackedToolCall {
  signal: AbortSignal;
  background: AbortSignal;
  end(): void;
}

interface CallControllers {
  stop: AbortController;
  background: AbortController;
}

export class ToolStops {
  private calls = new Map<string, CallControllers>();

  private trigger(toolCallId: string, action: keyof CallControllers): boolean {
    const controllers = this.calls.get(toolCallId);
    if (!controllers) return false;
    controllers[action].abort();
    return true;
  }

  track(toolCallId: string | undefined, turnSignal?: AbortSignal): TrackedToolCall {
    const controllers = { stop: new AbortController(), background: new AbortController() };
    const signal = turnSignal
      ? AbortSignal.any([turnSignal, controllers.stop.signal])
      : controllers.stop.signal;
    if (toolCallId) this.calls.set(toolCallId, controllers);
    return {
      signal,
      background: controllers.background.signal,
      end: () => {
        if (toolCallId && this.calls.get(toolCallId) === controllers) this.calls.delete(toolCallId);
      },
    };
  }

  stop(toolCallId: string): boolean {
    return this.trigger(toolCallId, "stop");
  }

  background(toolCallId: string): boolean {
    return this.trigger(toolCallId, "background");
  }
}
