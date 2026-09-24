import { useState, useEffect, useRef } from "react";
import type { UserIntent } from "@/interceptor-agents/governor/types";
import { reframeSatisfaction } from "@/lib/reframeSatisfaction";
import { Shield } from "lucide-react";
import { AVAILABLE_TOOLS, DEFAULT_INJECTORS, type ConsoleEvent, type InjectorMeta } from "@/types";
import { IntentsTab } from "./IntentsTab";
import { ToolsTab } from "./ToolsTab";
import { InjectorsTab } from "./InjectorsTab";
import { ConsoleTab } from "./ConsoleTab";

// Re-export types for backward compatibility

export interface ConstraintsAndIntentsPanelProps {
  intentStack?: UserIntent[];
  completedIntents?: UserIntent[];
  globalConstraints?: string[];
  consoleEvents?: ConsoleEvent[];
  onClearConsole?: () => void;
  enabledTools?: string[];
  onToggleTool?: (toolName: string) => void;
  onSetAllTools?: (isEnabled: boolean) => void;
  injectors?: InjectorMeta[];
}

export function ConstraintsAndIntentsPanel({
  intentStack = [],
  completedIntents = [],
  globalConstraints = [],
  consoleEvents = [],
  onClearConsole,
  enabledTools = ["read_file", "write_file", "list_files", "run_command"],
  onToggleTool,
  onSetAllTools,
  injectors = DEFAULT_INJECTORS,
}: ConstraintsAndIntentsPanelProps) {
  const [activeTab, setActiveTab] = useState<
    "intent" | "constraints" | "console" | "tools" | "injectors"
  >("intent");
  const [reframedMap, setReframedMap] = useState<Record<string, string>>({});
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(new Set());
  const [expandedToolNames, setExpandedToolNames] = useState<Set<string>>(new Set());
  const [expandedInjectorIds, setExpandedInjectorIds] = useState<Set<string>>(
    new Set(["governor"])
  );
  const inFlightReference = useRef<Set<string>>(new Set());

  const [uncontrolledTools, setUncontrolledTools] = useState<string[]>(enabledTools);
  const activeEnabledTools = onToggleTool ? enabledTools : uncontrolledTools;

  const handleToolToggle = (name: string) => {
    if (onToggleTool) {
      onToggleTool(name);
    } else {
      setUncontrolledTools((previous) =>
        previous.includes(name) ? previous.filter((n) => n !== name) : [...previous, name]
      );
    }
  };

  const handleSetAll = (isEnabled: boolean) => {
    if (onSetAllTools) {
      onSetAllTools(isEnabled);
    } else {
      setUncontrolledTools(isEnabled ? AVAILABLE_TOOLS.map((t) => t.name) : []);
    }
  };

  const toggleToolExpanded = (name: string) => {
    setExpandedToolNames((previous) => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleInjectorExpanded = (id: string) => {
    setExpandedInjectorIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleEventExpanded = (id: string) => {
    setExpandedEventIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpanded = (key: string) => {
    setExpandedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  useEffect(() => {
    const allIntents = [...intentStack, ...completedIntents];

    async function fetchReframe(key: string, description: string) {
      try {
        const condition = await reframeSatisfaction(description);
        if (condition) {
          setReframedMap((previous) => ({ ...previous, [key]: condition }));
        }
      } catch {
        setReframedMap((previous) => ({ ...previous, [key]: description }));
      } finally {
        inFlightReference.current.delete(key);
      }
    }

    for (const intent of allIntents) {
      const key = intent.id || intent.description;
      if (!key || Object.hasOwn(reframedMap, key) || inFlightReference.current.has(key)) continue;

      inFlightReference.current.add(key);
      void fetchReframe(key, intent.description);
    }
  }, [intentStack, completedIntents, reframedMap]);

  return (
    <div className="bg-background flex h-full flex-col select-none">
      {/* Flat Tabs Header */}
      <div className="border-border/80 flex h-9 items-center gap-1 overflow-x-auto border-b px-2 text-xs">
        <button
          onClick={() => setActiveTab("intent")}
          className={`shrink-0 cursor-pointer rounded-xs px-2 py-1 font-medium transition-colors ${
            activeTab === "intent"
              ? "bg-muted/70 text-foreground"
              : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
          }`}
        >
          Intent
          {intentStack.length > 0 && (
            <span className="text-primary ml-1 text-[10px] font-semibold">
              {intentStack.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("constraints")}
          className={`shrink-0 cursor-pointer rounded-xs px-2 py-1 font-medium transition-colors ${
            activeTab === "constraints"
              ? "bg-muted/70 text-foreground"
              : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
          }`}
        >
          constraints
          {globalConstraints.length > 0 && (
            <span className="text-muted-foreground ml-1 text-[10px] font-normal">
              {globalConstraints.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("console")}
          className={`shrink-0 cursor-pointer rounded-xs px-2 py-1 font-medium transition-colors ${
            activeTab === "console"
              ? "bg-muted/70 text-foreground"
              : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
          }`}
        >
          console
          {consoleEvents.length > 0 && (
            <span className="text-muted-foreground ml-1 font-mono text-[10px]">
              {consoleEvents.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("tools")}
          className={`shrink-0 cursor-pointer rounded-xs px-2 py-1 font-medium transition-colors ${
            activeTab === "tools"
              ? "bg-muted/70 text-foreground"
              : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
          }`}
        >
          tools
          <span className="text-muted-foreground ml-1 font-mono text-[10px]">
            {activeEnabledTools.length}/{AVAILABLE_TOOLS.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab("injectors")}
          className={`shrink-0 cursor-pointer rounded-xs px-2 py-1 font-medium transition-colors ${
            activeTab === "injectors"
              ? "bg-muted/70 text-foreground"
              : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
          }`}
        >
          injectors
          <span className="text-muted-foreground ml-1 font-mono text-[10px]">
            {injectors.length}
          </span>
        </button>

        {activeTab === "console" && consoleEvents.length > 0 && onClearConsole && (
          <div className="ml-auto shrink-0">
            <button
              type="button"
              onClick={onClearConsole}
              className="text-muted-foreground hover:bg-muted/40 hover:text-foreground cursor-pointer rounded-xs px-1.5 py-0.5 font-mono text-[10px] transition-colors"
              title="Clear Console"
            >
              clear
            </button>
          </div>
        )}
      </div>

      {/* Flat List Content */}
      <div className="flex-1 overflow-y-auto p-2">
        {activeTab === "intent" && (
          <IntentsTab
            intentStack={intentStack}
            completedIntents={completedIntents}
            reframedMap={reframedMap}
            expandedKeys={expandedKeys}
            onToggleExpand={toggleExpanded}
          />
        )}

        {activeTab === "constraints" && (
          <div>
            {globalConstraints.length === 0 ? (
              <div className="text-muted-foreground p-3 text-xs">No active constraints.</div>
            ) : (
              <div className="space-y-0.5">
                {globalConstraints.map((constraint, index) => (
                  <div
                    key={index}
                    className="text-foreground hover:bg-muted/40 flex items-start gap-2 rounded-xs px-2 py-1.5 text-xs transition-colors"
                  >
                    <Shield className="text-muted-foreground mt-0.5 size-3.5 shrink-0 opacity-70" />
                    <span className="leading-snug">{constraint}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "console" && (
          <ConsoleTab
            consoleEvents={consoleEvents}
            expandedEventIds={expandedEventIds}
            onToggleExpand={toggleEventExpanded}
          />
        )}

        {activeTab === "tools" && (
          <ToolsTab
            activeEnabledTools={activeEnabledTools}
            expandedToolNames={expandedToolNames}
            onToggleTool={handleToolToggle}
            onSetAllTools={handleSetAll}
            onToggleExpand={toggleToolExpanded}
          />
        )}

        {activeTab === "injectors" && (
          <InjectorsTab
            injectors={injectors}
            expandedInjectorIds={expandedInjectorIds}
            onToggleExpand={toggleInjectorExpanded}
          />
        )}
      </div>
    </div>
  );
}

export {
  type AgentToolMeta,
  type InjectorPhase,
  type ConsoleEvent,
  type InjectorMeta,
  AVAILABLE_TOOLS,
  DEFAULT_INJECTORS,
} from "@/types";
