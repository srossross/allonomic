import { useState, useEffect, useCallback } from "react";
import { ArrowRight, Globe, GraduationCap, Shield } from "lucide-react";
import {
  AVAILABLE_MODES,
  DEFAULT_EXECUTION_MODE,
  DEFAULT_GOVERNOR_MODE,
  GOVERNOR_MODES,
  DEFAULT_MODEL_ID,
  type ThinkingLevel,
  type ExecutionMode,
  type GovernorMode,
  type ModelOption,
  type UserPrompt,
  type UserPromptValue,
} from "@/types";
import { ModeSelector } from "./ModeSelector";
import { ModelSelector } from "./ModelSelector";
import { PromptSurface } from "./PromptSurface";
import { ContextMeter } from "./ContextMeter";

const GOVERNOR_MODE_LABELS: Record<GovernorMode, string> = {
  off: "off",
  "no-false-completion": "on, false completion off",
  full: "on",
};

export interface PendingPrompt {
  messageId: string;
  toolId: string;
  toolName: string;
  prompt: UserPrompt;
  promptId: string;
}

interface ChatComposerProperties {
  loading: boolean;
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
  pendingPrompt?: PendingPrompt | null;
  onRespondToPrompt?: (value: UserPromptValue) => void;
}

export function ChatComposer({
  loading,
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
  pendingPrompt,
  onRespondToPrompt,
}: ChatComposerProperties) {
  const [input, setInput] = useState("");
  const inputTokenLimit = models?.find((m) => m.id === selectedModel)?.inputTokenLimit;
  const contextMeter = <ContextMeter usedTokens={contextTokens} limitTokens={inputTokenLimit} />;

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
      if (
        e.key !== "Tab" ||
        !e.shiftKey ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      cycleMode();
    };

    globalThis.addEventListener("keydown", handleGlobalKeyDown);
    return () => globalThis.removeEventListener("keydown", handleGlobalKeyDown);
  }, [cycleMode]);

  if (pendingPrompt) {
    return (
      <div className="border-border/80 bg-background border-t p-3">
        <div className="border-border/80 bg-background/90 focus-within:border-primary/50 relative flex flex-col rounded-2xl border p-2.5 shadow-xs transition-colors">
          <PromptSurface
            key={pendingPrompt.toolId}
            prompt={pendingPrompt.prompt}
            onRespond={(value) => onRespondToPrompt?.(value)}
          />
          {contextMeter}
        </div>
      </div>
    );
  }

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

  return (
    <div className="border-border/80 bg-background border-t p-3">
      <div className="border-border/80 bg-background/90 focus-within:border-primary/50 relative flex flex-col gap-2 rounded-2xl border p-2.5 shadow-xs transition-colors">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={2}
          disabled={loading}
          className="text-foreground placeholder:text-muted-foreground/60 w-full resize-none bg-transparent px-1 py-0.5 text-xs leading-relaxed focus:ring-0 focus:outline-none disabled:opacity-50"
        />

        <div className="flex items-center justify-between pt-0.5 text-xs select-none">
          <div className="flex items-center gap-1">
            <ModeSelector
              executionMode={executionMode}
              onSelectExecutionMode={onSelectExecutionMode}
            />

            <button
              type="button"
              onClick={onToggleHasNetworkAccess}
              aria-pressed={hasNetworkAccess}
              className={`flex cursor-pointer items-center rounded-xs px-1 py-0.5 text-xs transition-colors ${
                hasNetworkAccess
                  ? "font-medium text-sky-400 hover:bg-sky-500/15"
                  : "text-muted-foreground/60 hover:bg-muted/40 hover:text-muted-foreground"
              }`}
              title={`Network access for sandboxed shells: ${hasNetworkAccess ? "on" : "off"}`}
              aria-label="Network access"
            >
              <Globe className="size-3.5" />
            </button>

            <button
              type="button"
              onClick={onCycleGovernorMode}
              className={`flex cursor-pointer items-center gap-1 rounded-xs px-1 py-0.5 text-xs transition-colors ${
                governorMode === "off"
                  ? "text-muted-foreground/60 hover:bg-muted/40 hover:text-muted-foreground"
                  : "text-emerald-500 hover:bg-emerald-500/15"
              }`}
              title={`Governor: ${GOVERNOR_MODE_LABELS[governorMode]} (click to cycle)`}
              aria-label="Governor mode"
            >
              <Shield className="size-3.5" />
              <span className="flex items-center gap-0.5">
                {[1, 2].map((dot) => (
                  <span
                    key={dot}
                    className={`size-1 rounded-full ${
                      dot <= GOVERNOR_MODES.indexOf(governorMode)
                        ? "bg-current"
                        : "border border-current opacity-50"
                    }`}
                  />
                ))}
              </span>
            </button>

            <button
              type="button"
              onClick={onToggleTeacher}
              aria-pressed={isTeacherEnabled}
              className={`flex cursor-pointer items-center rounded-xs px-1 py-0.5 text-xs transition-colors ${
                isTeacherEnabled
                  ? "font-medium text-amber-500 hover:bg-amber-500/15"
                  : "text-muted-foreground/60 hover:bg-muted/40 hover:text-muted-foreground"
              }`}
              title={`Tool teacher: ${isTeacherEnabled ? "on" : "off"}`}
              aria-label="Tool teacher"
            >
              <GraduationCap className="size-3.5" />
            </button>

            <ModelSelector
              selectedModel={selectedModel}
              onSelectModel={onSelectModel}
              thinkingLevel={thinkingLevel}
              onSelectThinkingLevel={onSelectThinkingLevel}
              models={models}
            />
          </div>

          <div className="flex items-center">
            {loading ? (
              <button
                type="button"
                onClick={onStopMessage}
                className="group border-border/50 bg-muted text-foreground hover:bg-muted/80 flex size-7 cursor-pointer items-center justify-center rounded-full border shadow-xs transition-colors"
                title="Stop generation"
              >
                <div className="size-2.5 rounded-xs bg-red-500 transition-colors group-hover:bg-red-600" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim()}
                className={`flex size-7 items-center justify-center rounded-full text-white shadow-xs transition-all ${
                  input.trim()
                    ? "bg-brand hover:bg-brand/90 cursor-pointer"
                    : "bg-muted-foreground/30 text-muted-foreground cursor-not-allowed opacity-50"
                }`}
                title="Send prompt (Enter)"
              >
                <ArrowRight strokeWidth={2.5} className="size-3.5" />
              </button>
            )}
          </div>
        </div>
        {contextMeter}
      </div>
    </div>
  );
}
