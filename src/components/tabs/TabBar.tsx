import { Plus, X, Loader2, Pause } from "lucide-react";
import { useEffect, useState } from "react";
import { TAB_BAR_CLASS, tabCellClass } from "./tabStyles";
import { activateOnKey } from "@/lib/activateOnKey";

interface TabItem {
  id: string;
  title: string;
  showContext?: boolean;
  loading?: boolean;
  hasUnread?: boolean;
  isPaused?: boolean;
  needsInput?: boolean;
}

interface TabBarProperties {
  tabs: TabItem[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  onToggleContext?: (tabId: string) => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onToggleContext,
}: TabBarProperties) {
  const [isControlHeld, setIsControlHeld] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      setIsControlHeld(e.ctrlKey);
      if (!e.ctrlKey || e.metaKey || e.key < "1" || e.key > "9") return;
      const tab = tabs[Number(e.key) - 1];
      if (!tab) return;
      e.preventDefault();
      onSelectTab(tab.id);
    };
    const handleKeyUp = (e: KeyboardEvent) => setIsControlHeld(e.ctrlKey);
    const handleBlur = () => setIsControlHeld(false);
    globalThis.addEventListener("keydown", handleKeyDown);
    globalThis.addEventListener("keyup", handleKeyUp);
    globalThis.addEventListener("blur", handleBlur);
    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
      globalThis.removeEventListener("keyup", handleKeyUp);
      globalThis.removeEventListener("blur", handleBlur);
    };
  }, [tabs, onSelectTab]);

  return (
    <div className={`${TAB_BAR_CLASS} overflow-x-auto`}>
      <div className="flex h-full min-w-0 flex-1 items-center">
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;

          let statusIcon: React.ReactNode;
          if (tab.needsInput) {
            statusIcon = <div className="size-2 rounded-full bg-amber-500" title="Needs input" />;
          } else if (tab.isPaused) {
            statusIcon = (
              <div title="Paused">
                <Pause className="size-3 text-amber-500" />
              </div>
            );
          } else if (tab.loading) {
            statusIcon = (
              <div title="Running">
                <Loader2 className="size-3 animate-spin text-blue-500" />
              </div>
            );
          } else if (tab.hasUnread) {
            statusIcon = <div className="size-2 rounded-full bg-blue-500" title="Awaiting" />;
          }

          return (
            <div
              key={tab.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectTab(tab.id)}
              onKeyDown={activateOnKey(() => onSelectTab(tab.id))}
              className={`group relative max-w-50 ${tabCellClass(isActive)}`}
            >
              {isControlHeld && index < 9 && (
                <span className="border-border bg-background text-muted-foreground text-2xs pointer-events-none absolute top-1/2 right-1 z-10 -translate-y-1/2 rounded-sm border px-1 font-mono shadow-sm">
                  ⌃{index + 1}
                </span>
              )}
              <span className="flex-1 truncate text-xs">{tab.title}</span>

              {statusIcon && (
                <div className="flex w-4 shrink-0 items-center justify-center">{statusIcon}</div>
              )}

              {onToggleContext && isActive && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleContext(tab.id);
                  }}
                  className={`text-2xs rounded-xs px-1 py-0.5 font-mono leading-none transition-colors ${
                    tab.showContext
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  title="Toggle Full Current Context (Worker LLM)"
                >
                  {"</>"}
                </button>
              )}

              {tabs.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className="hover:bg-muted text-muted-foreground hover:text-foreground rounded-xs p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                  title="Close Tab"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={onNewTab}
          className="text-muted-foreground hover:bg-muted/40 hover:text-foreground border-border/80 flex h-full items-center gap-1 border-r px-3 transition-colors"
          title="New Tab (⌘T)"
        >
          <Plus className="size-3.5" />
          <kbd className="text-2xs hidden font-mono opacity-60 sm:inline">⌘T</kbd>
        </button>
      </div>
    </div>
  );
}
