import { useState } from "react";
import { type Message, type ContextMessage, type ThinkingLevel, type ExecutionMode } from "@/types";
import { ChatHeader } from "./ChatHeader";
import { ContextView } from "./ContextView";
import { ChatMessageItem } from "./ChatMessageItem";
import { ChatComposer } from "./ChatComposer";

// Re-export types for backward compatibility

export interface ChatPanelProps {
  messages: Message[];
  contextMessages?: ContextMessage[];
  showContext?: boolean;
  onToggleContext?: () => void;
  loading?: boolean;
  onSendMessage: (text: string) => void;
  onStopMessage?: () => void;
  selectedModel?: string;
  onSelectModel?: (model: string) => void;
  thinkingLevel?: ThinkingLevel;
  onSelectThinkingLevel?: (level: ThinkingLevel) => void;
  executionMode?: ExecutionMode;
  onSelectExecutionMode?: (mode: ExecutionMode) => void;
  onCycleExecutionMode?: () => void;
  onApproveTool?: (messageId: string, toolId: string, args?: Record<string, unknown>) => void;
  onRejectTool?: (messageId: string, toolId: string) => void;
}

export function ChatPanel({
  messages,
  contextMessages = [],
  showContext = false,
  onToggleContext,
  loading = false,
  onSendMessage,
  onStopMessage,
  selectedModel = "gemini-2.5-flash",
  onSelectModel,
  thinkingLevel = "High",
  onSelectThinkingLevel,
  executionMode = "manual",
  onSelectExecutionMode,
  onCycleExecutionMode,
  onApproveTool,
  onRejectTool,
}: ChatPanelProps) {
  const [expandedThoughtIds, setExpandedThoughtIds] = useState<Set<string>>(new Set());
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(new Set());

  const toggleThought = (id: string) => {
    setExpandedThoughtIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleToolCall = (id: string) => {
    setExpandedToolIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const contextList: ContextMessage[] =
    contextMessages && contextMessages.length > 0
      ? contextMessages
      : messages.map((m) => ({
          role: m.role === "user" ? "human" : "ai",
          content: m.content,
        }));

  const pendingWrite = (() => {
    for (let mIndex = messages.length - 1; mIndex >= 0; mIndex--) {
      const msg = messages[mIndex];
      if (msg.role !== "assistant" || !msg.toolCalls) continue;
      for (let tcIndex = msg.toolCalls.length - 1; tcIndex >= 0; tcIndex--) {
        const tc = msg.toolCalls[tcIndex];
        if (tc.status === "pending" && tc.name === "write_file") {
          const toolId = tc.id || `${msg.id}-tc-${tcIndex}`;
          const filePath = String(tc.args?.filePath || tc.args?.path || "file");
          return { messageId: msg.id, toolId, filePath, args: tc.args };
        }
      }
    }
    return null;
  })();

  return (
    <div className="border-border/80 bg-background flex h-full flex-col border-r">
      <ChatHeader
        showContext={showContext}
        contextCount={contextList.length}
        loading={loading}
        onToggleContext={onToggleContext}
      />

      <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {showContext ? (
          <ContextView contextList={contextList} />
        ) : messages.length === 0 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
            No messages yet. Send a prompt to run the governed agent loop.
          </div>
        ) : (
          messages.map((message) => (
            <ChatMessageItem
              key={message.id}
              message={message}
              isThoughtExpanded={expandedThoughtIds.has(message.id)}
              onToggleThought={() => toggleThought(message.id)}
              expandedToolIds={expandedToolIds}
              onToggleTool={toggleToolCall}
            />
          ))
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="border-border/40 bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-xs border px-2.5 py-1.5 font-mono text-xs">
              <span className="bg-primary size-2 animate-ping rounded-full" />
              <span>Thinking & evaluating workspace...</span>
            </div>
          </div>
        )}
      </div>

      <ChatComposer
        loading={loading}
        onSendMessage={onSendMessage}
        onStopMessage={onStopMessage}
        selectedModel={selectedModel}
        onSelectModel={onSelectModel}
        thinkingLevel={thinkingLevel}
        onSelectThinkingLevel={onSelectThinkingLevel}
        executionMode={executionMode}
        onSelectExecutionMode={onSelectExecutionMode}
        onCycleExecutionMode={onCycleExecutionMode}
        pendingWrite={pendingWrite}
        onApprovePendingWrite={() =>
          pendingWrite &&
          onApproveTool?.(pendingWrite.messageId, pendingWrite.toolId, pendingWrite.args)
        }
        onRejectPendingWrite={() =>
          pendingWrite && onRejectTool?.(pendingWrite.messageId, pendingWrite.toolId)
        }
      />
    </div>
  );
}

export {
  type ModelOption,
  type ToolCallInfo,
  AVAILABLE_MODELS,
  type Message,
  type ContextMessage,
  type ThinkingLevel,
  type ExecutionMode,
  AVAILABLE_MODES,
} from "@/types";
