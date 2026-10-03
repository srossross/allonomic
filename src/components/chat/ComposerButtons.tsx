import { ArrowRight, Loader2, Pause, Play } from "lucide-react";
import type { ComposerPhase } from "./composerPhase";

const pillButtonClass =
  "border-border/50 bg-muted text-foreground hover:bg-muted/80 flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs shadow-xs transition-colors";

export function ComposerButtons({
  phase,
  canSend,
  onSend,
  onPause,
  onStop,
}: {
  phase: ComposerPhase;
  canSend: boolean;
  onSend: () => void;
  onPause?: () => void;
  onStop?: () => void;
}) {
  const stop = (
    <button
      type="button"
      onClick={onStop}
      className={pillButtonClass}
      aria-label="Stop (Escape)"
      title="Stop (Esc)"
    >
      <div className="size-2.5 rounded-xs bg-red-500" />
    </button>
  );
  const play = (
    <button
      type="button"
      onClick={onSend}
      className={pillButtonClass}
      aria-label="Play (Enter)"
      title="Play (↵)"
    >
      <Play className="size-3" />
    </button>
  );
  switch (phase) {
    case "running": {
      return (
        <button
          type="button"
          onClick={onPause}
          className={pillButtonClass}
          aria-label="Pause (Escape)"
          title="Pause (Esc)"
        >
          <Pause className="size-3" />
        </button>
      );
    }
    case "pausing": {
      return (
        <>
          <Loader2 className="text-muted-foreground size-3 animate-spin" />
          {stop}
        </>
      );
    }
    case "paused":
    case "paused-idle": {
      return (
        <>
          {stop}
          {play}
        </>
      );
    }
    case "held": {
      return play;
    }
    case "idle": {
      return (
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          className={`flex size-7 items-center justify-center rounded-full text-white shadow-xs transition-all ${
            canSend
              ? "bg-brand hover:bg-brand/90 cursor-pointer"
              : "bg-muted-foreground/30 text-muted-foreground cursor-not-allowed opacity-50"
          }`}
          title="Send prompt (Enter)"
        >
          <ArrowRight strokeWidth={2.5} className="size-3.5" />
        </button>
      );
    }
  }
}
