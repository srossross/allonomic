import {
  CheckCircle2,
  HelpCircle,
  ArrowRightCircle,
  AlertCircle,
  CheckSquare,
  Circle,
} from "lucide-react";
import type { UserIntent } from "@/core/governor/types";

interface IntentRowProperties {
  intent: UserIntent;
  isDone: boolean;
  onSelect: () => void;
}

export function StatusIcon({ kind, done }: { kind: string; done?: boolean }) {
  if (done) {
    return (
      <span title="Completed">
        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
      </span>
    );
  }

  switch (kind) {
    case "question": {
      return (
        <span title="Question / Inquiry">
          <HelpCircle className="size-3.5 shrink-0 text-sky-500" />
        </span>
      );
    }
    case "request": {
      return (
        <span title="Request / Action">
          <ArrowRightCircle className="text-primary size-3.5 shrink-0" />
        </span>
      );
    }
    case "feedback": {
      return (
        <span title="Feedback">
          <AlertCircle className="size-3.5 shrink-0 text-amber-500" />
        </span>
      );
    }
    case "confirmation": {
      return (
        <span title="Confirmation">
          <CheckSquare className="size-3.5 shrink-0 text-purple-500" />
        </span>
      );
    }
    default: {
      return (
        <span title={kind || "Intent"}>
          <Circle className="text-muted-foreground size-3.5 shrink-0" />
        </span>
      );
    }
  }
}

export function IntentRow({ intent, isDone, onSelect }: IntentRowProperties) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full cursor-pointer items-start gap-2 rounded-xs px-2 py-1.5 text-left transition-colors ${
        isDone ? "text-muted-foreground/75 hover:bg-muted/20" : "text-foreground hover:bg-muted/40"
      }`}
    >
      <div className="shrink-0 pt-0.5">
        <StatusIcon kind={intent.kind} done={isDone} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={`text-xs leading-snug ${
            isDone ? "text-muted-foreground/80" : "text-foreground font-medium"
          }`}
        >
          {intent.description}
        </span>
        {intent.completed_when && (
          <span className="text-muted-foreground text-xs leading-snug">
            Done when: {intent.completed_when}
          </span>
        )}
      </div>
    </button>
  );
}
