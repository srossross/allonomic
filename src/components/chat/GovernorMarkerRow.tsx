import { CircleCheck, CircleX, LogOut, Undo2 } from "lucide-react";
import type { GovernorMarker } from "@/types";
import { StreamRow } from "./StreamRow";

function markerIcon(marker: GovernorMarker) {
  if (marker.kind === "popped") return <CircleX className="size-3.5" />;
  if (!marker.approved) return <Undo2 className="size-3.5" />;
  return marker.resolved.length > 0 ? (
    <CircleCheck className="size-3.5 text-emerald-600" />
  ) : (
    <LogOut className="size-3.5" />
  );
}

function exitHead(marker: Extract<GovernorMarker, { kind: "exit" }>): string {
  if (!marker.approved) {
    return marker.unmetIntent ? `Unmet: ${marker.unmetIntent}` : "Returned to worker";
  }
  return marker.resolved.length > 0
    ? `Resolved: ${marker.resolved.map((r) => r.text).join("; ")}`
    : "Exit approved";
}

function markerLabel(marker: GovernorMarker): string {
  if (marker.kind === "popped") return `Popped: ${marker.intent}`;
  const count = marker.assumptions.length;
  return `${exitHead(marker)} · ${count} assumption${count === 1 ? "" : "s"}`;
}

export function GovernorMarkerRow({
  marker,
  striped,
  isExpanded,
  onToggle,
}: {
  marker: GovernorMarker;
  striped: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="w-full">
      <StreamRow
        icon={markerIcon(marker)}
        iconTitle={marker.interceptor}
        striped={striped}
        isExpanded={isExpanded}
        onToggle={onToggle}
      >
        {markerLabel(marker)}
      </StreamRow>
      {isExpanded && marker.kind === "exit" && (
        <div className="border-border/80 bg-muted/20 text-muted-foreground/90 mt-1 mb-2 space-y-2 rounded-xs border-l-2 p-2 pl-3 text-xs leading-relaxed select-text">
          {marker.feedback && <div className="whitespace-pre-wrap">{marker.feedback}</div>}
          {marker.assumptions.length === 0 ? (
            <div>No assumptions.</div>
          ) : (
            <ul className="space-y-1.5">
              {marker.assumptions.map((a) => (
                <li key={a.id} className="flex gap-2">
                  {a.status === "resolved" ? (
                    <CircleCheck className="mt-0.5 size-3 shrink-0 text-emerald-600" />
                  ) : (
                    <span className="border-muted-foreground/60 mt-0.5 size-3 shrink-0 rounded-full border" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div>{a.text}</div>
                    {a.evidence && <div className="opacity-70">Evidence: {a.evidence}</div>}
                    {a.request && <div className="opacity-70">Request: {a.request}</div>}
                    <div className="text-2xs font-mono opacity-60">
                      {[a.resolver, a.impact_category, a.impact_cost, a.candidates]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
