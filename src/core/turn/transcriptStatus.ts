import type { PendingPrompt } from "../../types";
import type { TurnEvent } from "./events";

export function nextPendingPrompt(
  current: PendingPrompt | undefined,
  event: TurnEvent
): PendingPrompt | undefined {
  if (event.type === "prompt_requested") return { promptId: event.promptId, prompt: event.prompt };
  if (event.type === "prompt_answered" && event.promptId === current?.promptId) return undefined;
  return event.type === "turn_completed" || event.type === "turn_failed" ? undefined : current;
}

export function nextWaitingOn(current: string | undefined, event: TurnEvent): string | undefined {
  if (event.type === "waiting") return event.on;
  if (event.type === "paused") return "Paused";
  if (event.type === "resumed") return undefined;
  return event.type === "turn_completed" || event.type === "turn_failed" ? undefined : current;
}
