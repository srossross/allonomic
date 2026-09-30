import type { TabData } from "@/types";

export type ComposerPhase = "idle" | "running" | "pausing" | "paused" | "paused-idle" | "held";

export const PLACEHOLDERS: Record<ComposerPhase, string> = {
  idle: "Message…",
  running: "Type to queue — sent at next step",
  pausing: "Pausing after current step…",
  paused: "Paused — Enter to continue, Esc to stop",
  "paused-idle": "Paused — Enter sends queued messages",
  held: "Stopped — Enter sends queued messages",
};

export function statusText(phase: ComposerPhase, queued: number): string | undefined {
  const plural = queued === 1 ? "message" : "messages";
  switch (phase) {
    case "pausing": {
      return "Pausing… (finishing current step)";
    }
    case "paused": {
      return "Paused between steps — Enter to continue, Esc to stop";
    }
    case "paused-idle": {
      return `Paused — ${queued} queued ${plural} will send as one message on Enter`;
    }
    case "held": {
      return `Stopped — ${queued} queued ${plural} kept`;
    }
    default: {
      return undefined;
    }
  }
}

export function composerPhase(tab: TabData): ComposerPhase {
  if (tab.loading) return tab.pauseState ?? "running";
  if (tab.pauseState === "paused") return "paused-idle";
  return tab.queueHeld && (tab.queuedPrompts?.length ?? 0) > 0 ? "held" : "idle";
}
