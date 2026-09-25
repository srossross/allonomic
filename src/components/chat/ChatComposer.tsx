import { useState, useRef, useEffect, useCallback } from "react";
import { ArrowRight, FileCode } from "lucide-react";
import { AVAILABLE_MODES, DEFAULT_MODEL_ID, type ThinkingLevel, type ExecutionMode, type ModelOption } from "@/types";
import { ModeSelector } from "./ModeSelector";
import { ModelSelector } from "./ModelSelector";

export type PendingActionTool =
  | { type: "write"; messageId: string; toolId: string; filePath: string; args?: Record<string, unknown> }
  | { type: "command"; messageId: string; toolId: string; command: string; args?: Record<string, unknown> };

interface ChatComposerProperties {
  loading: boolean;
  onSendMessage: (text: string) => void;
  onStopMessage?: () => void;
  selectedModel?: string;
  onSelectModel?: (model: string) => void;
  models?: ModelOption[];
  thinkingLevel?: ThinkingLevel;
  onSelectThinkingLevel?: (level: ThinkingLevel) => void;
  executionMode?: ExecutionMode;
  onSelectExecutionMode?: (mode: ExecutionMode) => void;
  onCycleExecutionMode?: () => void;
  pendingAction?: PendingActionTool | null;
  onApprovePendingAction?: () => void;
  onRejectPendingAction?: () => void;
}

export function ChatComposer({
  loading,
  onSendMessage,
  onStopMessage,
  selectedModel = DEFAULT_MODEL_ID,
  onSelectModel,
  models,
  thinkingLevel = "Low",
  onSelectThinkingLevel,
  executionMode = "manual",
  onSelectExecutionMode,
  onCycleExecutionMode,
  pendingAction,
  onApprovePendingAction,
  onRejectPendingAction,
}: ChatComposerProperties) {
  const [input, setInput] = useState("");
  const pendingContainerReference = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pendingAction) {
      pendingContainerReference.current?.focus();
    }
  }, [pendingAction]);

  const cycleMode = useCallback(() => {
    if (onCycleExecutionMode) {
      onCycleExecutionMode();
      return;
    }
    if (!onSelectExecutionMode) {
      return;
    }
    const currentIndex = AVAILABLE_MODES.findIndex((m) => m.id === executionMode);
    const nextIndex = (currentIndex + 1) % AVAILABLE_MODES.length;
    onSelectExecutionMode(AVAILABLE_MODES[nextIndex].id);
  }, [executionMode, onCycleExecutionMode, onSelectExecutionMode]);

  // Global Shift+Tab listener so toggling works anywhere
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !e.shiftKey || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      e.preventDefault();
      cycleMode();
    };

    globalThis.addEventListener("keydown", handleGlobalKeyDown);
    return () => globalThis.removeEventListener("keydown", handleGlobalKeyDown);
  }, [cycleMode]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || loading) return;
    onSendMessage(text);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      cycleMode();
      return;
    }

    if (e.key !== "Enter" || e.shiftKey) {
      return;
    }

    e.preventDefault();
    handleSend();
  };

  const handlePendingKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onApprovePendingAction?.();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onRejectPendingAction?.();
    }
  };

  return (
    <div className="border-border/80 bg-background border-t p-3">
      <div className="border-border/80 bg-background/90 focus-within:border-primary/50 relative flex flex-col gap-2 rounded-2xl border p-2.5 shadow-xs transition-colors">
        {pendingAction ? (
          <div
            ref={pendingContainerReference}
            tabIndex={0}
            onKeyDown={handlePendingKeyDown}
            className="flex min-h-[50px] w-full cursor-default flex-col justify-center px-1.5 py-1 text-xs select-none focus:outline-none"
          >
            <div className="flex items-center gap-1.5 font-medium text-amber-400">
              <FileCode className="size-4 shrink-0 text-amber-400" />
              <span>
                Do you want to {pendingAction.type === "write" ? "write to the file" : "execute the command"}{" "}
                <span className="text-foreground font-mono font-semibold underline underline-offset-2">
                  {pendingAction.type === "write" ? pendingAction.filePath : pendingAction.command}
                </span>
                ?
              </span>
            </div>
            <div className="text-muted-foreground mt-1 text-[11px]">
              Press{" "}
              <kbd className="border-border/60 bg-muted text-foreground rounded border px-1 py-0.5 font-mono text-[10px] font-semibold">
                Enter
              </kbd>{" "}
              to Submit or{" "}
              <kbd className="border-border/60 bg-muted text-foreground rounded border px-1 py-0.5 font-mono text-[10px] font-semibold">
                Esc
              </kbd>{" "}
              to Reject
            </div>
          </div>
        ) : (
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={2}
            disabled={loading}
            className="text-foreground placeholder:text-muted-foreground/60 w-full resize-none bg-transparent px-1 py-0.5 text-xs leading-relaxed focus:ring-0 focus:outline-none disabled:opacity-50"
          />
        )}

        <div className="flex items-center justify-between pt-0.5 text-xs select-none">
          <div className="flex items-center gap-1">
            <ModeSelector
              executionMode={executionMode}
              onSelectExecutionMode={onSelectExecutionMode}
            />

            <ModelSelector
              selectedModel={selectedModel}
              onSelectModel={onSelectModel}
              thinkingLevel={thinkingLevel}
              onSelectThinkingLevel={onSelectThinkingLevel}
              models={models}
            />
          </div>

          {/* Action Area: Submit/Reject when pending action, or Send/Stop */}
          <div className="flex items-center">
            {pendingAction ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onRejectPendingAction}
                  className="border-border/60 bg-muted/60 text-muted-foreground hover:bg-destructive/20 hover:text-destructive cursor-pointer rounded-lg border px-2.5 py-1 text-xs transition-colors"
                  title="Reject action (Esc)"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={onApprovePendingAction}
                  className="rounded-xs bg-emerald-600 hover:bg-emerald-500 flex cursor-pointer items-center gap-1 px-3 py-1 text-xs font-medium text-white shadow-xs transition-colors"
                  title="Submit approval (Enter)"
                >
                  <span>Submit</span>
                  <span className="font-mono text-[10px] opacity-75">↵</span>
                </button>
              </div>
            ) : loading ? (
              <button
                type="button"
                onClick={onStopMessage}
                className="group border-border/50 bg-muted text-foreground hover:bg-muted/80 flex size-7 cursor-pointer items-center justify-center rounded-full border shadow-xs transition-colors"
                title="Stop generation"
              >
                <div className="size-2.5 rounded-[2px] bg-red-500 transition-colors group-hover:bg-red-600" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim()}
                className={`flex size-7 items-center justify-center rounded-full text-white shadow-xs transition-all ${
                  input.trim()
                    ? "cursor-pointer bg-[#0088cc] hover:bg-[#0077b3]"
                    : "bg-muted-foreground/30 text-muted-foreground cursor-not-allowed opacity-50"
                }`}
                title="Send prompt (Enter)"
              >
                <ArrowRight className="size-3.5 stroke-[2.5]" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
