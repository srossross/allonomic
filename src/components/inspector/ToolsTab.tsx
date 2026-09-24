import { AVAILABLE_TOOLS, type AgentToolMeta } from "@/types";
import { ToolRow } from "./ToolRow";

interface ToolsTabProperties {
  activeEnabledTools: string[];
  expandedToolNames: Set<string>;
  onToggleTool: (name: string) => void;
  onSetAllTools: (isEnabled: boolean) => void;
  onToggleExpand: (name: string) => void;
}

export function ToolsTab({
  activeEnabledTools,
  expandedToolNames,
  onToggleTool,
  onSetAllTools,
  onToggleExpand,
}: ToolsTabProperties) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1 text-xs">
        <span className="text-muted-foreground font-mono text-[10px] font-semibold tracking-wider uppercase">
          Agent Tools ({activeEnabledTools.length}/{AVAILABLE_TOOLS.length} active)
        </span>
        <div className="flex items-center gap-2 font-mono text-[10px]">
          <button
            type="button"
            onClick={() => onSetAllTools(true)}
            className="text-muted-foreground hover:text-foreground cursor-pointer hover:underline"
          >
            all on
          </button>
          <span className="text-muted-foreground/30">|</span>
          <button
            type="button"
            onClick={() => onSetAllTools(false)}
            className="text-muted-foreground hover:text-foreground cursor-pointer hover:underline"
          >
            all off
          </button>
        </div>
      </div>

      <div className="space-y-0.5">
        {AVAILABLE_TOOLS.map((tool: AgentToolMeta) => (
          <ToolRow
            key={tool.name}
            tool={tool}
            isEnabled={activeEnabledTools.includes(tool.name)}
            onToggle={() => onToggleTool(tool.name)}
            isExpanded={expandedToolNames.has(tool.name)}
            onToggleExpand={() => onToggleExpand(tool.name)}
          />
        ))}
      </div>
    </div>
  );
}
