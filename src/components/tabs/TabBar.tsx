import { Plus, X, MessageSquare } from "lucide-react";

export interface TabItem {
  id: string;
  title: string;
  projectId: string;
  showContext?: boolean;
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
    <div className="border-border/80 bg-muted/20 flex h-9 items-center gap-1 overflow-x-auto border-b px-1.5 text-xs select-none">
      {/* Tabs List */}
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`group flex max-w-[200px] cursor-pointer items-center gap-1.5 rounded-xs px-2.5 py-1 transition-colors ${
                isActive
                  ? "bg-background text-foreground border-border/80 border font-medium"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              }`}
            >
              <MessageSquare className="size-3 shrink-0 opacity-70" />
              <span className="flex-1 truncate text-xs">{tab.title}</span>

              {/* Context Toggle on active tab */}
              {onToggleContext && isActive && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleContext(tab.id);
                  }}
                  className={`rounded-xs px-1 py-0.5 font-mono text-[10px] leading-none transition-colors ${
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
          className="text-muted-foreground hover:bg-muted/40 hover:text-foreground flex items-center gap-1 rounded-xs px-1.5 py-1 transition-colors"
          title="New Tab (⌘T)"
        >
          <Plus className="size-3.5" />
          <kbd className="hidden font-mono text-[10px] opacity-60 sm:inline">⌘T</kbd>
        </button>
      </div>
    </div>
  );
}
