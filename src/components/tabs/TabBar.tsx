import { Plus, X, MessageSquare, Loader2 } from "lucide-react";
import { TAB_BAR_CLASS, tabCellClass } from "./tabStyles";

interface TabItem {
  id: string;
  title: string;
  projectId: string;
  showContext?: boolean;
  loading?: boolean;
  hasUnread?: boolean;
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
  return (
    <div className={`${TAB_BAR_CLASS} overflow-x-auto`}>
      {/* Tabs List */}
      <div className="flex h-full min-w-0 flex-1 items-center">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;

          // Determine status icon
          let statusIcon: React.ReactNode;
          if (tab.loading) {
            statusIcon = (
              <div title="Running">
                <Loader2 className="size-3 animate-spin text-blue-500" />
              </div>
            );
          } else if (tab.hasUnread) {
            statusIcon = <div className="size-2 rounded-full bg-blue-500" title="Awaiting" />;
          } else {
            statusIcon = (
              <span className="text-2xs opacity-50" title="Idle">
                💤
              </span>
            );
          }

          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`group max-w-50 ${tabCellClass(isActive)}`}
            >
              <MessageSquare className="size-3 shrink-0 opacity-70" />
              <span className="flex-1 truncate text-xs">{tab.title}</span>

              <div className="flex w-4 shrink-0 items-center justify-center">{statusIcon}</div>

              {/* Context Toggle on active tab */}
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

        {/* New Tab Button */}
        <button
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
