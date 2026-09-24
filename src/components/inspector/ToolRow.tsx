import { ChevronDown, Terminal, FileCode } from "lucide-react";
import type { AgentToolMeta } from "@/types";

interface ToolRowProperties {
  tool: AgentToolMeta;
  isEnabled: boolean;
  onToggle: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

function ToolToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-150 focus-visible:outline-none ${
        checked ? "bg-primary" : "bg-muted-foreground/30 hover:bg-muted-foreground/40"
      }`}
    >
      <span
        className={`bg-background pointer-events-none inline-block size-3 transform rounded-full shadow-xs transition-transform duration-150 ${
          checked ? "translate-x-3.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function ToolRow({
  tool,
  isEnabled,
  onToggle,
  isExpanded,
  onToggleExpand,
}: ToolRowProperties) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xs">
      <div
        className={`group flex items-center justify-between gap-2 rounded-xs px-2 py-1.5 transition-colors select-none ${
          isExpanded ? "bg-muted/50" : "hover:bg-muted/30"
        }`}
      >
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        >
          <ChevronDown
            className={`text-muted-foreground size-3 shrink-0 transition-transform duration-150 ${
              isExpanded ? "" : "-rotate-90 opacity-40 group-hover:opacity-80"
            }`}
          />
          <div className="text-muted-foreground group-hover:text-foreground shrink-0 pt-0.5">
            {tool.category === "shell" ? (
              <Terminal className="size-3.5 text-amber-500/80" />
            ) : (
              <FileCode className="size-3.5 text-sky-500/80" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span
                className={`font-mono text-xs ${
                  isEnabled
                    ? "text-foreground font-medium"
                    : "text-muted-foreground/60 line-through"
                }`}
              >
                {tool.name}
              </span>
              <span className="bg-muted py-0.2 text-muted-foreground rounded-xs px-1 font-mono text-[9px] tracking-wider uppercase">
                {tool.category}
              </span>
            </div>
            <p className="text-muted-foreground mt-0.5 truncate text-[10px] leading-tight">
              {tool.description}
            </p>
          </div>
        </button>

        <div className="flex shrink-0 items-center pl-2">
          <ToolToggleSwitch
            checked={isEnabled}
            onChange={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          />
        </div>
      </div>

      {isExpanded && (
        <div className="border-primary/40 bg-muted/25 mx-2 mt-0.5 mb-1.5 space-y-1.5 rounded-xs border-l-2 p-2 font-mono text-xs select-text">
          <div className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
            Parameters ({tool.parameters.length})
          </div>
          <div className="space-y-1">
            {tool.parameters.map((parameter, pIndex) => (
              <div key={pIndex} className="text-[11px] leading-snug">
                <span className="text-foreground font-semibold">{parameter.name}</span>
                <span className="text-muted-foreground ml-1 text-[10px]">
                  ({parameter.type}
                  {parameter.required ? ", required" : ", optional"})
                </span>
                <div className="text-muted-foreground/80 pl-2 text-[10px]">
                  {parameter.description}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
