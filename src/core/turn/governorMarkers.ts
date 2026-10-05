import type { GovernorMarker, Message } from "../../types";
import type { GovernorState } from "../governor/types";
import type { TurnEventOf } from "./events";

function markerMessage(event: { turnIndex: number; seq: number }, marker: GovernorMarker): Message {
  return {
    id: `governor-${event.turnIndex}-${event.seq}`,
    role: "assistant",
    content: "",
    governor: marker,
  };
}

export function popMarkerMessage(
  event: TurnEventOf<"governor_action">,
  result: Record<string, unknown>
): Message | undefined {
  if (result.status !== "popped") return;
  return markerMessage(event, {
    kind: "popped",
    interceptor: event.interceptor,
    intent: String(result.description),
  });
}

export function exitMarkerMessage(
  state: GovernorState,
  messages: Message[],
  event: TurnEventOf<"governor_verdict">
): Message {
  const shown = new Set(
    messages
      .flatMap((m) => (m.governor?.kind === "exit" ? m.governor.resolved : []))
      .map((r) => r.id)
  );
  return markerMessage(event, {
    kind: "exit",
    interceptor: event.interceptor,
    approved: event.approved,
    feedback: event.feedback,
    resolved: state.resolved_since_prompt
      .filter((i) => !shown.has(i.id))
      .map((i) => ({ id: i.id, text: i.completed_when ?? i.description })),
    unmetIntent: state.intent_stack.find((i) => i.id === event.intentId)?.description,
    assumptions: state.assumptions,
  });
}
