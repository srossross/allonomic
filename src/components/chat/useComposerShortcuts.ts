import { useEffect } from "react";
import type { PendingPrompt } from "@/types";
import type { ComposerPhase } from "./composerPhase";

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function useComposerShortcuts({
  phase,
  pendingPrompt,
  onCycleExecutionMode,
  onPause,
  onStopMessage,
}: {
  phase: ComposerPhase;
  pendingPrompt?: PendingPrompt | null;
  onCycleExecutionMode: () => void;
  onPause?: () => void;
  onStopMessage?: () => void;
}) {
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !e.shiftKey || isEditable(e.target)) return;
      e.preventDefault();
      onCycleExecutionMode();
    };
    globalThis.addEventListener("keydown", handleGlobalKeyDown);
    return () => globalThis.removeEventListener("keydown", handleGlobalKeyDown);
  }, [onCycleExecutionMode]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (pendingPrompt || e.repeat || e.defaultPrevented || e.key !== "Escape") return;
      if (phase === "running") onPause?.();
      else if (phase === "idle" || phase === "held") return;
      else onStopMessage?.();
      e.preventDefault();
    };
    globalThis.addEventListener("keydown", handleEscape);
    return () => globalThis.removeEventListener("keydown", handleEscape);
  }, [phase, pendingPrompt, onPause, onStopMessage]);
}
