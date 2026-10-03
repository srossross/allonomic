import { useState } from "react";
import { ArrowDown } from "lucide-react";
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
import { streamRowCount } from "./streamRows";
import type { ToolControls } from "./ToolCallRows";
import { PresentationView } from "./PresentationView";
import { groupExploreRuns } from "./exploreGroups";
import { ChatComposer } from "./ChatComposer";
import type { ComposerPhase } from "./composerPhase";
import { useFollowScroll } from "./useFollowScroll";
import { findPendingPrompt } from "./pendingPrompt";
import type { QueuedPrompt } from "@/core/graph/turnControl";
import { toggleInSet } from "@/lib/toggleInSet";

function turnOf(messages: Message[], presentation: Message): Message[] {
  const end = messages.indexOf(presentation);
  const start = messages.findLastIndex(
    (m, index) => index < end && m.role === "user" && !m.brief && !m.isQueued
  );
  return messages.slice(start + 1, end);
}

export interface ChatPanelProps {
  sessionId: string;
  messages: Message[];
  contextMessages?: ContextMessage[];
  showContext?: boolean;
  loading?: boolean;
  phase: ComposerPhase;
  queuedPrompts?: QueuedPrompt[];
  waitingOn?: string;
  onSendMessage: (text: string) => void;
  onStopMessage?: () => void;
  toolControls?: ToolControls;
  onPause?: () => void;
  onResume?: (text: string) => void;
  onRemoveQueued?: (id: string) => boolean;
  onPopQueued?: () => string | undefined;
  onRetry?: () => void;
  selectedModel?: string;
  onSelectModel?: (model: string) => void;
  models?: ModelOption[];
  contextTokens?: number;
  thinkingLevel?: ThinkingLevel;
  onSelectThinkingLevel?: (level: ThinkingLevel) => void;
  executionMode?: ExecutionMode;
  onSelectExecutionMode?: (mode: ExecutionMode) => void;
  onCycleExecutionMode: () => void;
  hasNetworkAccess?: boolean;
  onToggleHasNetworkAccess?: () => void;
  governorMode?: GovernorMode;
  onCycleGovernorMode?: () => void;
  isTeacherEnabled?: boolean;
  onToggleTeacher?: () => void;
  onRespondToPrompt?: (promptId: string, value: UserPromptValue) => void;
  collapseWorkerText?: boolean;
  openIntents?: string[];
}

export function ChatPanel({
  sessionId,
  messages,
  contextMessages = [],
  showContext = false,
  loading = false,
  phase,
  queuedPrompts = [],
  waitingOn,
  onSendMessage,
  onStopMessage,
  toolControls,
  onPause,
  onResume,
  onRemoveQueued,
  onPopQueued,
  onRetry,
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
  collapseWorkerText = true,
  openIntents = [],
}: ChatPanelProps) {
  const [expandedThoughtIds, setExpandedThoughtIds] = useState<Set<string>>(new Set());
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(new Set());

  const toggleThought = (id: string) => {
    setExpandedThoughtIds((previous) => toggleInSet(previous, id));
  };

  const toggleToolCall = (id: string) => {
    setExpandedToolIds((previous) => toggleInSet(previous, id));
  };

  const contextList: ContextMessage[] =
    contextMessages && contextMessages.length > 0
      ? contextMessages
      : messages.map((m) => ({
          role: m.role === "user" ? "human" : "ai",
          content: m.content,
        }));

  const pendingPrompt = findPendingPrompt(messages);
  const { scrollRef, contentRef, sentinelRef, isFollowing, hasUnseen, scrollToBottom } =
    useFollowScroll(sessionId, messages);

  const streamItems = groupExploreRuns(messages);
  const rowOffsets: number[] = [];
  let rowCount = 0;
  for (const { message, toolItems } of streamItems) {
    rowOffsets.push(rowCount);
    rowCount += streamRowCount(message, toolItems, collapseWorkerText);
  }

  return (
    <div className="bg-background relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        <div ref={contentRef} className="space-y-2.5">
          {showContext ? (
            <ContextView contextList={contextList} />
          ) : messages.length === 0 ? (
            <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
              No messages yet. Send a prompt to run the governed agent loop.
            </div>
          ) : (
            <div className="space-y-1">
              {streamItems.map(({ message, toolItems }, index) => (
                <ChatMessageItem
                  key={message.id}
                  rowOffset={rowOffsets[index]}
                  message={message}
                  toolItems={toolItems}
                  isThoughtExpanded={expandedThoughtIds.has(message.id)}
                  onToggleThought={() => toggleThought(message.id)}
                  isTextCollapsed={collapseWorkerText}
                  isTextExpanded={expandedThoughtIds.has(`${message.id}:text`)}
                  onToggleText={() => toggleThought(`${message.id}:text`)}
                  presentation={
                    message.presentation && (
                      <PresentationView
                        presentation={message.presentation}
                        turn={turnOf(messages, message)}
                        openIntents={openIntents}
                        isActive={!loading && message === messages.at(-1)}
                        onSend={onSendMessage}
                      />
                    )
                  }
                  expandedToolIds={expandedToolIds}
                  onToggleTool={toggleToolCall}
                  toolControls={toolControls}
                  onRetry={
                    onRetry && !loading && message.isError && message === messages.at(-1)
                      ? onRetry
                      : undefined
                  }
                />
              ))}
            </div>
          )}

          {loading && !pendingPrompt && (
            <div className="flex justify-start">
              <div className="border-border/40 bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-xs border px-2.5 py-1.5 font-mono text-xs">
                <span className="bg-primary size-2 animate-ping rounded-full" />
                <span>{waitingOn ?? "Starting…"}</span>
              </div>
            </div>
          )}

          <ChatComposer
            sessionId={sessionId}
            phase={phase}
            queuedPrompts={queuedPrompts}
            onSendMessage={onSendMessage}
            onStopMessage={onStopMessage}
            onPause={onPause}
            onResume={onResume}
            onRemoveQueued={onRemoveQueued}
            onPopQueued={onPopQueued}
            onInputChange={scrollToBottom}
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
          <div ref={sentinelRef} aria-hidden="true" />
        </div>
      </div>
      {!isFollowing && hasUnseen && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="border-border bg-background text-foreground hover:bg-muted absolute bottom-3 left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-1 rounded-full border px-3 py-1 text-xs shadow-md"
        >
          <ArrowDown className="size-3" />
          {pendingPrompt ? "Needs input" : "New messages"}
        </button>
      )}
    </div>
  );
}
