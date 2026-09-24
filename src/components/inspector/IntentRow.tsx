import {
  ChevronDown,
  CheckCircle2,
  HelpCircle,
  ArrowRightCircle,
  AlertCircle,
  CheckSquare,
  Circle,
} from "lucide-react";
import type { UserIntent } from "@/interceptor-agents/governor/types";

interface IntentRowProperties {
  intent: UserIntent;
  isDone: boolean;
  displayText: string;
  isExpanded: boolean;
  onToggle: () => void;
}

function StatusIcon({ kind, done }: { kind: string; done?: boolean }) {
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

export function IntentRow({
  intent,
  isDone,
  displayText,
  isExpanded,
  onToggle,
}: IntentRowProperties) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xs">
      <button
        type="button"
        onClick={onToggle}
        className={`group flex w-full cursor-pointer items-start gap-2 rounded-xs px-2 py-1.5 text-left transition-colors ${
          isExpanded
            ? "bg-muted/50 text-foreground"
            : isDone
              ? "text-muted-foreground/75 hover:bg-muted/20"
              : "text-foreground hover:bg-muted/40"
        }`}
      >
        <div className="shrink-0 pt-0.5">
          <StatusIcon kind={intent.kind} done={isDone} />
        </div>
        <div className="min-w-0 flex-1">
          <span
            className={`block text-xs leading-snug ${
              isDone ? "text-muted-foreground/80" : "text-foreground font-medium"
            }`}
          >
            {displayText}
          </span>
          {!isExpanded && intent.constraints && intent.constraints.length > 0 && (
            <div className="border-border/60 text-muted-foreground mt-0.5 truncate border-l pl-2 text-[10px]">
              {intent.constraints.join("; ")}
            </div>
          )}
        </div>
        <ChevronDown
          className={`text-muted-foreground mt-0.5 size-3.5 shrink-0 transition-transform duration-150 ${
            isExpanded ? "" : "-rotate-90 opacity-60 group-hover:opacity-100"
          }`}
        />
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="border-primary/40 bg-muted/25 mx-2 mt-0.5 mb-1.5 space-y-2 rounded-xs border-l-2 p-2 text-xs">
          {/* Metadata header */}
          <div className="text-muted-foreground flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground/80 font-mono">{intent.id || "intent"}</span>
            <div className="flex items-center gap-1.5">
              <span className="bg-muted text-muted-foreground rounded-xs px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase">
                {intent.kind}
              </span>
              <span className={`font-medium ${isDone ? "text-emerald-500" : "text-primary"}`}>
                {isDone ? "Satisfied" : "Active"}
              </span>
            </div>
          </div>

          {/* Raw User Goal / Description */}
          <div>
            <div className="text-muted-foreground mb-0.5 text-[10px] font-semibold tracking-wider uppercase">
              Original Intent
            </div>
            <p className="text-foreground/90 text-xs leading-relaxed select-text">
              {intent.description}
            </p>
          </div>

          {/* Reframed Condition (if different from description) */}
          {displayText !== intent.description && (
            <div>
              <div className="text-muted-foreground mb-0.5 text-[10px] font-semibold tracking-wider uppercase">
                Satisfaction Condition
              </div>
              <p className="text-foreground/80 text-xs leading-relaxed select-text">
                {displayText}
              </p>
            </div>
          )}

          {/* Constraints */}
          {intent.constraints && intent.constraints.length > 0 && (
            <div>
              <div className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wider uppercase">
                Constraints ({intent.constraints.length})
              </div>
              <ul className="text-muted-foreground list-disc space-y-0.5 pl-3 text-xs">
                {intent.constraints.map((c, cIndex) => (
                  <li key={cIndex} className="leading-snug select-text">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
