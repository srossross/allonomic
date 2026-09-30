import { useEffect, useRef, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import type { UserIntent, FalseCompletion } from "@/core/governor/types";
import { StatusIcon } from "./IntentRow";
import { FalseCompletionIcon } from "./FalseCompletionRow";

interface IntentDetailViewProperties {
  intent: UserIntent;
  isDone: boolean;
  falseCompletions: FalseCompletion[];
  reframed: string | undefined;
  reframeError?: string;
  focusFalseCompletionId: string | null;
  onBack: () => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-muted-foreground text-2xs mb-0.5 font-semibold tracking-wider uppercase">
        {label}
      </div>
      <div className="text-foreground/90 text-xs leading-relaxed select-text">{children}</div>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="bg-muted text-muted-foreground text-2xs rounded-xs px-1.5 py-0.5 font-medium tracking-wide uppercase">
      {children}
    </span>
  );
}

function FalseCompletionDetail({
  falseCompletion,
  isFocused,
}: {
  falseCompletion: FalseCompletion;
  isFocused: boolean;
}) {
  const reference = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isFocused) reference.current?.scrollIntoView({ block: "start" });
  }, [isFocused]);

  return (
    <div
      ref={reference}
      className={`border-border/60 space-y-2 rounded-xs border-l-2 p-2 ${
        falseCompletion.resolution === null ? "" : "opacity-60"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="shrink-0 pt-0.5">
          <FalseCompletionIcon resolution={falseCompletion.resolution} />
        </div>
        <span className="text-foreground text-xs leading-snug font-medium">
          {falseCompletion.summary}
        </span>
      </div>
      <div className="text-muted-foreground text-2xs flex flex-wrap items-center gap-1.5">
        <span className="font-mono">{falseCompletion.id}</span>
        <Chip>{falseCompletion.resolution ?? "open"}</Chip>
      </div>
      <Field label="Completes As">{falseCompletion.completes_as}</Field>
      <Field label="False Because">{falseCompletion.false_because}</Field>
      <Field label="Check">{falseCompletion.check}</Field>
      <Field label="Evidence">
        {falseCompletion.evidence ? (
          <>
            <div className="text-muted-foreground text-2xs font-mono">
              {falseCompletion.evidence.source}
            </div>
            <blockquote className="border-border mt-0.5 border-l-2 pl-2 font-mono whitespace-pre-wrap">
              {falseCompletion.evidence.quote}
            </blockquote>
          </>
        ) : (
          <span className="text-muted-foreground">No evidence</span>
        )}
      </Field>
      {falseCompletion.resolution_reason && (
        <Field label="Resolution Reason">{falseCompletion.resolution_reason}</Field>
      )}
      {falseCompletion.still_assumed && (
        <Field label="Still Assumed">{falseCompletion.still_assumed}</Field>
      )}
    </div>
  );
}

export function IntentDetailView({
  intent,
  isDone,
  falseCompletions,
  reframed,
  reframeError,
  focusFalseCompletionId,
  onBack,
}: IntentDetailViewProperties) {
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 text-xs font-medium transition-colors"
      >
        <ChevronLeft className="size-3.5" />
        Intent
      </button>

      <div className="space-y-2 px-1">
        <div className="flex items-start gap-2">
          <div className="shrink-0 pt-0.5">
            <StatusIcon kind={intent.kind} done={isDone} />
          </div>
          <span className="text-foreground text-xs leading-snug font-medium select-text">
            {intent.description}
          </span>
        </div>
        <div className="text-muted-foreground text-2xs flex flex-wrap items-center gap-1.5">
          <span className="font-mono">{intent.id}</span>
          <Chip>{intent.kind}</Chip>
          <span className={`font-medium ${isDone ? "text-emerald-500" : "text-primary"}`}>
            {isDone ? "Satisfied" : "Active"}
          </span>
        </div>
        {reframed && reframed !== intent.description && (
          <Field label="Satisfaction Condition">{reframed}</Field>
        )}
        {reframeError && (
          <Field label="Satisfaction Condition">
            <span className="text-destructive">{reframeError}</span>
          </Field>
        )}
      </div>

      <div className="space-y-2 px-1">
        <div className="text-muted-foreground text-2xs font-semibold tracking-wider uppercase">
          False completions ({falseCompletions.length})
        </div>
        {falseCompletions.length === 0 ? (
          <div className="text-muted-foreground text-xs">None</div>
        ) : (
          falseCompletions.map((falseCompletion) => (
            <FalseCompletionDetail
              key={falseCompletion.id}
              falseCompletion={falseCompletion}
              isFocused={falseCompletion.id === focusFalseCompletionId}
            />
          ))
        )}
      </div>
    </div>
  );
}
