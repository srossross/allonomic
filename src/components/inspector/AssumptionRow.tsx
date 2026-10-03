import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { Assumption } from "@/core/governor/types";

export function AssumptionIcon({ status }: { status: Assumption["status"] }) {
  const Icon = status === "open" ? AlertTriangle : CheckCircle2;
  const className = status === "open" ? "text-amber-500" : "text-emerald-500";
  return (
    <span title={status}>
      <Icon className={`size-3.5 shrink-0 ${className}`} />
    </span>
  );
}

interface AssumptionRowProperties {
  assumption: Assumption;
  onSelect: () => void;
}

export function AssumptionRow({ assumption, onSelect }: AssumptionRowProperties) {
  const isOpen = assumption.status === "open";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`hover:bg-muted/40 flex w-full cursor-pointer items-start gap-2 rounded-xs py-1 pr-2 pl-7 text-left transition-colors ${
        isOpen ? "" : "opacity-50"
      }`}
    >
      <div className="shrink-0 pt-0.5">
        <AssumptionIcon status={assumption.status} />
      </div>
      <span className="text-foreground/90 min-w-0 flex-1 text-xs leading-snug">
        {assumption.text}
      </span>
      <span className="text-muted-foreground text-2xs shrink-0">{assumption.impact_category}</span>
    </button>
  );
}
