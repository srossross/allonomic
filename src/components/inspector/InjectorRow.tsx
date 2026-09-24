import { ChevronDown } from "lucide-react";
import type { InjectorMeta } from "@/types";

interface InjectorRowProperties {
  injector: InjectorMeta;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export function InjectorRow({ injector, isExpanded, onToggleExpand }: InjectorRowProperties) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xs">
      <button
        type="button"
        onClick={onToggleExpand}
        className={`group flex w-full cursor-pointer items-start gap-2 rounded-xs px-2 py-2 text-left transition-colors select-none ${
          isExpanded ? "bg-muted/50" : "hover:bg-muted/30"
        }`}
      >
        <div className="shrink-0 pt-1">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="py-0.2 rounded-xs bg-purple-500/15 px-1.5 text-[10px] leading-none font-semibold tracking-wide text-purple-400">
              GOV:{injector.name}
            </span>
            <span className="text-foreground font-mono text-xs font-medium">{injector.name}</span>
            <span className="bg-muted py-0.2 text-muted-foreground rounded-xs px-1 font-mono text-[9px]">
              {injector.modelName}
            </span>
            <span className="ml-auto pr-1 text-[10px] font-medium text-emerald-500">active</span>
          </div>

          <p className="text-muted-foreground mt-1 text-[11px] leading-snug">
            {injector.description}
          </p>
        </div>

        <ChevronDown
          className={`text-muted-foreground mt-1 size-3.5 shrink-0 transition-transform duration-150 ${
            isExpanded ? "" : "-rotate-90 opacity-50 group-hover:opacity-100"
          }`}
        />
      </button>

      {isExpanded && (
        <div className="border-primary/40 bg-muted/25 mx-2 mt-0.5 mb-2 space-y-2 rounded-xs border-l-2 p-2.5 text-xs select-text">
          <div className="border-border/40 text-muted-foreground flex items-center justify-between border-b pb-1 font-mono text-[10px]">
            <span>Type: {injector.type}</span>
            {injector.constraintsPath && <span>Policy: {injector.constraintsPath}</span>}
          </div>

          <div>
            <div className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wider uppercase">
              Pipeline Execution Phases ({injector.phases.length})
            </div>
            <div className="space-y-1.5 pl-1">
              {injector.phases.map((ph, index) => (
                <div key={index} className="border-border/60 border-l pl-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-foreground text-xs font-medium">{ph.name}</span>
                    <span className="text-primary/80 font-mono text-[10px]">{ph.hook}</span>
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-[10px] leading-tight">
                    {ph.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
