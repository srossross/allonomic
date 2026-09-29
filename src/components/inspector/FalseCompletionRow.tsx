import {
  AlertTriangle,
  CheckCircle2,
  MessageCircle,
  CircleDashed,
  type LucideIcon,
} from "lucide-react";
import type { FalseCompletionResolution, FalseCompletion } from "@/core/governor/types";

const RESOLUTION_ICONS: Record<FalseCompletionResolution, { icon: LucideIcon; className: string }> =
  {
    ruled_out: { icon: CheckCircle2, className: "text-emerald-500" },
    clarified: { icon: MessageCircle, className: "text-sky-500" },
    invalid: { icon: CircleDashed, className: "text-muted-foreground" },
    superseded: { icon: CircleDashed, className: "text-muted-foreground" },
  };

export function FalseCompletionIcon({
  resolution,
}: {
  resolution: FalseCompletionResolution | null;
}) {
  const { icon: Icon, className } =
    resolution === null
      ? { icon: AlertTriangle, className: "text-amber-500" }
      : RESOLUTION_ICONS[resolution];
  return (
    <span title={resolution ?? "open"}>
      <Icon className={`size-3.5 shrink-0 ${className}`} />
    </span>
  );
}

interface FalseCompletionRowProperties {
  falseCompletion: FalseCompletion;
  onSelect: () => void;
}

export function FalseCompletionRow({ falseCompletion, onSelect }: FalseCompletionRowProperties) {
  const isOpen = falseCompletion.resolution === null;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`hover:bg-muted/40 flex w-full cursor-pointer items-start gap-2 rounded-xs py-1 pr-2 pl-7 text-left transition-colors ${
        isOpen ? "" : "opacity-50"
      }`}
    >
      <div className="shrink-0 pt-0.5">
        <FalseCompletionIcon resolution={falseCompletion.resolution} />
      </div>
      <span className="text-foreground/90 min-w-0 flex-1 text-xs leading-snug">
        {falseCompletion.summary}
      </span>
      {!isOpen && (
        <span className="text-muted-foreground text-2xs shrink-0">
          {falseCompletion.resolution}
        </span>
      )}
    </button>
  );
}
