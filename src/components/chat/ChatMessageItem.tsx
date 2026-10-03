import type { ReactNode } from "react";
import { Brain, MessageSquare, RotateCcw, Target } from "lucide-react";
import type { Message } from "@/types";
import type { ToolItem } from "./exploreGroups";
import { StreamRow } from "./StreamRow";
import { isCollapsedWorkerText } from "./streamRows";
import { ExploreGroup, ToolCallRow, type ToolControls } from "./ToolCallRows";

interface ChatMessageItemProperties {
  message: Message;
  toolItems: ToolItem[];
  isThoughtExpanded: boolean;
  onToggleThought: () => void;
  expandedToolIds: Set<string>;
  onToggleTool: (toolId: string) => void;
  toolControls?: ToolControls;
  onRetry?: () => void;
  isTextCollapsed?: boolean;
  isTextExpanded?: boolean;
  onToggleText?: () => void;
  presentation?: ReactNode;
  rowOffset?: number;
}

export function ChatMessageItem({
  message,
  toolItems,
  isThoughtExpanded,
  onToggleThought,
  expandedToolIds,
  onToggleTool,
  toolControls,
  onRetry,
  isTextCollapsed = false,
  isTextExpanded = false,
  onToggleText,
  presentation,
  rowOffset = 0,
}: ChatMessageItemProperties) {
  const isWorkerText = isCollapsedWorkerText(message, isTextCollapsed);
  let row = rowOffset;
  const isNextStriped = () => row++ % 2 === 1;
  return (
    <div
      className={`flex w-full flex-col items-start gap-1 ${message.role === "user" ? "pt-3 first:pt-0" : ""}`}
    >
      {message.role === "assistant" && (message.thinking || toolItems.length > 0) && (
        <div className="w-full space-y-1 select-text">
          {message.thinking && (
            <div>
              <StreamRow
                icon={<Brain className="size-3.5" />}
                striped={isNextStriped()}
                isExpanded={isThoughtExpanded}
                onToggle={onToggleThought}
              >
                {message.thinkingDurationSeconds === undefined
                  ? "Thought"
                  : `Thought for ${message.thinkingDurationSeconds}s`}
              </StreamRow>
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
                      striped={isNextStriped()}
                      expandedToolIds={expandedToolIds}
                      onToggleTool={onToggleTool}
                      toolControls={toolControls}
                    />
                  );
                }
                const entry = item.kind === "explore" ? item.entries[0] : item.entry;
                return (
                  <ToolCallRow
                    key={entry.toolId}
                    entry={entry}
                    striped={isNextStriped()}
                    isExpanded={expandedToolIds.has(entry.toolId)}
                    onToggleTool={onToggleTool}
                    toolControls={toolControls}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}

      {message.brief && (
        <div className="w-full">
          <StreamRow
            icon={<Target className="size-3.5" />}
            iconTitle={message.brief.interceptor}
            striped={isNextStriped()}
            isExpanded={isThoughtExpanded}
            onToggle={onToggleThought}
          >
            {message.brief.doneWhen.length > 0 ? message.brief.doneWhen.join("; ") : "Brief"}
          </StreamRow>
          {isThoughtExpanded && (
            <div className="border-border/80 bg-muted/20 text-muted-foreground/90 mt-1 mb-2 rounded-xs border-l-2 p-2 pl-3 text-xs leading-relaxed whitespace-pre-wrap select-text">
              {message.brief.text}
            </div>
          )}
        </div>
      )}

      {presentation && <div className="w-full pt-2">{presentation}</div>}

      {Boolean(message.content) && isWorkerText && (
        <StreamRow
          icon={<MessageSquare className="size-3.5" />}
          striped={isNextStriped()}
          isExpanded={isTextExpanded}
          onToggle={() => onToggleText?.()}
        >
          <span className="block truncate">
            {message.content.split("\n").find((line) => line.trim()) ?? ""}
          </span>
        </StreamRow>
      )}

      {Boolean(message.content) && !message.brief && (!isWorkerText || isTextExpanded) && (
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
