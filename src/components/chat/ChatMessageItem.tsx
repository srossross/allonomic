import { ChevronRight, RotateCcw, Target } from "lucide-react";
import type { Message } from "@/types";
import type { ToolItem } from "./exploreGroups";
import { ExploreGroup, ToolCallRow } from "./ToolCallRows";

interface ChatMessageItemProperties {
  message: Message;
  toolItems: ToolItem[];
  isThoughtExpanded: boolean;
  onToggleThought: () => void;
  expandedToolIds: Set<string>;
  onToggleTool: (toolId: string) => void;
  onRetry?: () => void;
}

export function ChatMessageItem({
  message,
  toolItems,
  isThoughtExpanded,
  onToggleThought,
  expandedToolIds,
  onToggleTool,
  onRetry,
}: ChatMessageItemProperties) {
  return (
    <div className="flex w-full flex-col items-start">
      {message.role === "assistant" && (
        <div className="mb-2 w-full space-y-1 select-text">
          {message.thinking && (
            <div>
              <button
                type="button"
                onClick={onToggleThought}
                className="group text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5 py-0.5 text-xs font-normal transition-colors select-none"
              >
                <span className="text-muted-foreground group-hover:text-foreground font-normal">
                  {message.thinkingDurationSeconds === undefined
                    ? "Thought"
                    : `Thought for ${message.thinkingDurationSeconds}s`}
                </span>
                <ChevronRight
                  className={`text-muted-foreground size-3 transition-transform duration-150 ${
                    isThoughtExpanded ? "rotate-90" : ""
                  }`}
                />
              </button>
              {isThoughtExpanded && (
                <div className="border-border/80 bg-muted/20 text-muted-foreground/90 mt-1 mb-2 max-h-60 overflow-y-auto rounded-xs border-l-2 p-2 pl-3 font-mono text-xs leading-relaxed whitespace-pre-wrap select-text">
                  {message.thinking}
                </div>
              )}
            </div>
          )}

          {toolItems.length > 0 && (
            <div className="space-y-1">
              {toolItems.map((item) => {
                if (item.kind === "explore" && item.entries.length > 1) {
                  return (
                    <ExploreGroup
                      key={item.id}
                      id={item.id}
                      entries={item.entries}
                      expandedToolIds={expandedToolIds}
                      onToggleTool={onToggleTool}
                    />
                  );
                }
                const entry = item.kind === "explore" ? item.entries[0] : item.entry;
                return (
                  <ToolCallRow
                    key={entry.toolId}
                    entry={entry}
                    isExpanded={expandedToolIds.has(entry.toolId)}
                    onToggleTool={onToggleTool}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}

      {message.brief && (
        <div className="w-full">
          <button
            type="button"
            onClick={onToggleThought}
            className="group text-muted-foreground hover:text-foreground flex cursor-pointer items-start gap-1.5 py-0.5 text-left text-xs font-normal transition-colors select-none"
          >
            <Target className="mt-0.5 size-3 shrink-0" />
            <span>
              {message.brief.doneWhen.length > 0 ? message.brief.doneWhen.join("; ") : "Brief"}
            </span>
            <ChevronRight
              className={`text-muted-foreground mt-0.5 size-3 shrink-0 transition-transform duration-150 ${
                isThoughtExpanded ? "rotate-90" : ""
              }`}
            />
          </button>
          {isThoughtExpanded && (
            <div className="border-border/80 bg-muted/20 text-muted-foreground/90 mt-1 mb-2 rounded-xs border-l-2 p-2 pl-3 text-xs leading-relaxed whitespace-pre-wrap select-text">
              {message.brief.text}
            </div>
          )}
        </div>
      )}

      {Boolean(message.content) && !message.brief && (
        <div
          className={`w-full rounded-xs px-2.5 py-1.5 text-left text-xs leading-relaxed whitespace-pre-wrap ${
            message.role === "user"
              ? "bg-primary text-primary-foreground"
              : message.content.startsWith("Error:")
                ? "border-destructive/20 bg-destructive/10 text-destructive border"
                : "border-border/50 bg-muted/40 text-foreground border"
          }`}
        >
          {message.isQueued && (
            <span className="text-2xs mr-1.5 font-mono uppercase opacity-70">sent mid-turn</span>
          )}
          {message.content}
          {onRetry && (
            <div className="mt-1.5 flex justify-end">
              <button
                type="button"
                onClick={onRetry}
                className="border-destructive/40 hover:bg-destructive/20 flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors"
              >
                <RotateCcw className="size-3" />
                <span>Try again</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
