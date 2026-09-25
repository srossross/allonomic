import { Plus, X, MessageSquare, Loader2 } from "lucide-react";

export interface TabItem {
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
    <div className="border-border/80 bg-muted/20 flex shrink-0 h-9 items-center overflow-x-auto border-b text-xs select-none">
      {/* Tabs List */}
      <div className="flex h-full min-w-0 flex-1 items-center">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          
          // Determine status icon
          let StatusIcon = null;
          if (tab.loading) {
            StatusIcon = <div title="Running"><Loader2 className="size-3 animate-spin text-blue-500" /></div>;
          } else if (tab.hasUnread) {
            StatusIcon = <div className="size-2 rounded-full bg-blue-500" title="Awaiting" />;
          } else {
            StatusIcon = <span className="text-[10px] opacity-50" title="Idle">💤</span>;
          }

          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`group flex h-[calc(100%+1px)] max-w-[200px] cursor-pointer items-center gap-1.5 border-r border-border/80 px-3 transition-colors ${
                isActive
                  ? "bg-background text-foreground font-medium border-b border-b-background relative before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:bg-primary"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground border-b border-b-transparent"
              }`}
            >
              <MessageSquare className="size-3 shrink-0 opacity-70" />
              <span className="flex-1 truncate text-xs">{tab.title}</span>

              <div className="flex items-center justify-center w-4 shrink-0">
                {StatusIcon}
              </div>

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
          className="text-muted-foreground hover:bg-muted/40 hover:text-foreground flex h-full items-center gap-1 px-3 transition-colors border-r border-border/80"
          title="New Tab (⌘T)"
        >
          <Plus className="size-3.5" />
          <kbd className="hidden font-mono text-[10px] opacity-60 sm:inline">⌘T</kbd>
        </button>
      </div>
    </div>
  );
}
