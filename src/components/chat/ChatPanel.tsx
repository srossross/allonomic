import { useState } from "react";
import {
  type Message,
  type ContextMessage,
  type ThinkingLevel,
  type ExecutionMode,
  type GovernorMode,
  type ModelOption,
  type UserPromptValue,
  DEFAULT_MODEL_ID,
  DEFAULT_EXECUTION_MODE,
  DEFAULT_GOVERNOR_MODE,
} from "@/types";
import { ContextView } from "./ContextView";
import { ChatMessageItem } from "./ChatMessageItem";
import { groupExploreRuns } from "./exploreGroups";
import { ChatComposer, type PendingPrompt } from "./ChatComposer";

// Re-export types for backward compatibility

export interface ChatPanelProps {
  messages: Message[];
  contextMessages?: ContextMessage[];
  showContext?: boolean;
  onToggleContext?: () => void;
  loading?: boolean;
  waitingOn?: string;
  onSendMessage: (text: string) => void;
  onStopMessage?: () => void;
  selectedModel?: string;
  onSelectModel?: (model: string) => void;
  models?: ModelOption[];
  contextTokens?: number;
  thinkingLevel?: ThinkingLevel;
  onSelectThinkingLevel?: (level: ThinkingLevel) => void;
  executionMode?: ExecutionMode;
  onSelectExecutionMode?: (mode: ExecutionMode) => void;
  onCycleExecutionMode?: () => void;
  hasNetworkAccess?: boolean;
  onToggleHasNetworkAccess?: () => void;
  governorMode?: GovernorMode;
  onCycleGovernorMode?: () => void;
  isTeacherEnabled?: boolean;
  onToggleTeacher?: () => void;
  onRespondToPrompt?: (promptId: string, value: UserPromptValue) => void;
}

export function ChatPanel({
  messages,
  contextMessages = [],
  showContext = false,
  onToggleContext: _onToggleContext,
  loading = false,
  waitingOn,
  onSendMessage,
  onStopMessage,
  selectedModel = DEFAULT_MODEL_ID,
  onSelectModel,
  models,
  contextTokens,
  thinkingLevel = "Low",
  onSelectThinkingLevel,
  executionMode = DEFAULT_EXECUTION_MODE,
  onSelectExecutionMode,
  onCycleExecutionMode,
  hasNetworkAccess = false,
  onToggleHasNetworkAccess,
  governorMode = DEFAULT_GOVERNOR_MODE,
  onCycleGovernorMode,
  isTeacherEnabled = true,
  onToggleTeacher,
  onRespondToPrompt,
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

  const pendingPrompt: PendingPrompt | null = (() => {
    for (let mIndex = messages.length - 1; mIndex >= 0; mIndex--) {
      const msg = messages[mIndex];
      if (msg.role !== "assistant" || !msg.toolCalls) continue;
      for (let tcIndex = msg.toolCalls.length - 1; tcIndex >= 0; tcIndex--) {
        const tc = msg.toolCalls[tcIndex];
        if (tc.status !== "pending" || !tc.prompt || !tc.promptId) continue;
        const toolId = tc.id || `${msg.id}-tc-${tcIndex}`;
        return {
          messageId: msg.id,
          toolId,
          toolName: tc.name,
          prompt: tc.prompt,
          promptId: tc.promptId,
        };
      }
    }
    return null;
  })();

  return (
    <div className="bg-background flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {showContext ? (
          <ContextView contextList={contextList} />
        ) : messages.length === 0 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
            No messages yet. Send a prompt to run the governed agent loop.
          </div>
        ) : (
          groupExploreRuns(messages).map(({ message, toolItems }) => (
            <ChatMessageItem
              key={message.id}
              message={message}
              toolItems={toolItems}
              isThoughtExpanded={expandedThoughtIds.has(message.id)}
              onToggleThought={() => toggleThought(message.id)}
              expandedToolIds={expandedToolIds}
              onToggleTool={toggleToolCall}
            />
          ))
        )}

        {loading && !pendingPrompt && (
          <div className="flex justify-start">
            <div className="border-border/40 bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-xs border px-2.5 py-1.5 font-mono text-xs">
              <span className="bg-primary size-2 animate-ping rounded-full" />
              <span>{waitingOn ?? "Starting…"}</span>
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
        models={models}
        contextTokens={contextTokens}
        thinkingLevel={thinkingLevel}
        onSelectThinkingLevel={onSelectThinkingLevel}
        executionMode={executionMode}
        onSelectExecutionMode={onSelectExecutionMode}
        onCycleExecutionMode={onCycleExecutionMode}
        hasNetworkAccess={hasNetworkAccess}
        onToggleHasNetworkAccess={onToggleHasNetworkAccess}
        governorMode={governorMode}
        onCycleGovernorMode={onCycleGovernorMode}
        isTeacherEnabled={isTeacherEnabled}
        onToggleTeacher={onToggleTeacher}
        pendingPrompt={pendingPrompt}
        onRespondToPrompt={(value) =>
          pendingPrompt && onRespondToPrompt?.(pendingPrompt.promptId, value)
        }
      />
    </div>
  );
}
