import { invokeWithRetry } from "../retry";
import type { TurnEventSink } from "./events";
import type { InterceptorHook } from "../graph/types";

export const WORKER_SOURCE = "worker";
export const TOOL_SOURCE = "tool";
export const RATE_LIMIT_SOURCE = "rate_limit";
export const USER_SOURCE = "user";

export interface WaitingTarget {
  events: TurnEventSink;
  source: string;
  hook?: InterceptorHook;
}

export function invokeWaiting<T>(
  { events, source, hook }: WaitingTarget,
  on: string,
  operation: () => Promise<T>
): Promise<T> {
  return invokeWithRetry(
    () => {
      events.emit({ type: "waiting", on, source, hook });
      return operation();
    },
    {
      onRetry: (attempt, delayMs) =>
        events.emit({
          type: "waiting",
          on: `${on} · rate limited, retry ${attempt} in ${Math.round(delayMs / 1000)}s`,
          source: RATE_LIMIT_SOURCE,
        }),
    }
  );
}
