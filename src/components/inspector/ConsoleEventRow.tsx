import { ChevronDown } from "lucide-react";
import type { ConsoleBadgeVariant, ConsoleEvent } from "@/types";

interface ConsoleEventRowProperties {
  event: ConsoleEvent;
  isExpanded: boolean;
  onToggle: () => void;
}

function getBadgeStyle(variant: ConsoleBadgeVariant) {
  switch (variant) {
    case "sky": {
      return "bg-sky-500/15 text-sky-400";
    }
    case "purple": {
      return "bg-purple-500/15 text-purple-400";
    }
    case "amber": {
      return "bg-amber-500/15 text-amber-400";
    }
    case "emerald": {
      return "bg-emerald-500/15 text-emerald-400";
    }
    case "destructive": {
      return "bg-destructive/15 text-destructive font-semibold";
    }
    default: {
      return "bg-muted text-muted-foreground";
    }
  }
}

export function ConsoleEventRow({ event, isExpanded, onToggle }: ConsoleEventRowProperties) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xs">
      {/* Default: strictly ONE line */}
      <button
        type="button"
        onClick={onToggle}
        className={`group flex w-full cursor-pointer items-center gap-2 rounded-xs px-2 py-1 text-left font-mono text-xs transition-colors select-none ${
          isExpanded
            ? "bg-muted/50 text-foreground"
            : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
        }`}
      >
        <span className="text-muted-foreground/60 shrink-0 font-mono text-[10px]">
          {event.timestamp}
        </span>
        <span
          className={`py-0.2 shrink-0 rounded-xs px-1 text-[10px] leading-none font-semibold tracking-wide ${getBadgeStyle(
            event.badgeVariant
          )}`}
        >
          {event.badge}
        </span>
        <span className="text-foreground/90 flex-1 truncate font-mono text-xs">
          {event.summary}
        </span>
        <ChevronDown
          className={`text-muted-foreground size-3 shrink-0 transition-transform duration-150 ${
            isExpanded ? "" : "-rotate-90 opacity-40 group-hover:opacity-80"
          }`}
        />
      </button>

      {/* Expanded payload / details drawer */}
      {isExpanded && event.details != null && (
        <div className="border-primary/40 bg-muted/25 mx-2 mt-0.5 mb-1.5 space-y-1.5 rounded-xs border-l-2 p-2 font-mono text-xs select-text">
          <div className="border-border/40 text-muted-foreground flex items-center justify-between border-b pb-1 text-[10px]">
            <span>{event.type}</span>
            <span>{event.timestamp}</span>
          </div>

          {typeof event.details === "object" ? (
            <pre className="border-border/40 bg-background/50 text-foreground/90 overflow-x-auto rounded-xs border p-1.5 text-[11px] leading-relaxed whitespace-pre">
              {JSON.stringify(event.details, null, 2)}
            </pre>
          ) : (
            <div className="text-foreground/90 text-[11px] whitespace-pre-wrap">
              {String(event.details)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
