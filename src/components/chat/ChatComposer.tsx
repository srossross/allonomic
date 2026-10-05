import { useState, useEffect, useRef } from "react";
import { Globe, GraduationCap, Shield } from "lucide-react";
import {
  DEFAULT_EXECUTION_MODE,
  DEFAULT_GOVERNOR_MODE,
  GOVERNOR_MODES,
  DEFAULT_MODEL_ID,
  type ThinkingLevel,
  type ExecutionMode,
  type GovernorMode,
  type ModelOption,
  type UserPromptValue,
} from "@/types";
import type { QueuedPrompt } from "@/core/graph/turnControl";
import type { PendingPrompt } from "@/types";
import { ModeSelector } from "./ModeSelector";
import { ModelSelector } from "./ModelSelector";
import { PromptSurface } from "./PromptSurface";
import { ContextMeter } from "./ContextMeter";
import { ComposerButtons } from "./ComposerButtons";
import { QueuedPromptList } from "./QueuedPromptList";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { useSlashCommands, type SlashCommand } from "./useSlashCommands";
import { PLACEHOLDERS, statusText, type ComposerPhase } from "./composerPhase";
import { useAutosizeTextarea } from "./useAutosizeTextarea";
import { useComposerDraft } from "./useComposerDraft";
import { useComposerShortcuts } from "./useComposerShortcuts";

const GOVERNOR_MODE_LABELS: Record<GovernorMode, string> = {
  off: "off",
  "intent-only": "on, assumptions off",
  full: "on",
};

const ALREADY_SENT_MS = 2000;

interface ChatComposerProperties {
  sessionId: string;
  phase: ComposerPhase;
  queuedPrompts: QueuedPrompt[];
  onSendMessage: (text: string) => void;
  onStopMessage?: () => void;
  onPause?: () => void;
  onResume?: (text: string) => void;
  onRemoveQueued?: (id: string) => boolean;
  onPopQueued?: () => string | undefined;
  draft?: { text: string; nonce: number };
  onInputChange?: () => void;
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
  pendingPrompt?: PendingPrompt | null;
  onRespondToPrompt?: (value: UserPromptValue) => void;
}

export function ChatComposer({
  sessionId,
  phase,
  queuedPrompts,
  onSendMessage,
  onStopMessage,
  onPause,
  onResume,
  onRemoveQueued,
  onPopQueued,
  draft,
  onInputChange,
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
  const [isAlreadySentShown, setIsAlreadySentShown] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const alreadySentTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(alreadySentTimerRef.current), []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [sessionId]);
  useAutosizeTextarea(textareaRef, input, pendingPrompt);
  useComposerDraft(draft, setInput, textareaRef);

  const inputTokenLimit = models?.find((m) => m.id === selectedModel)?.inputTokenLimit;
  const contextMeter = <ContextMeter usedTokens={contextTokens} limitTokens={inputTokenLimit} />;

  useComposerShortcuts({ phase, pendingPrompt, onCycleExecutionMode, onPause, onStopMessage });

  const handleSelectCommand = (command: SlashCommand) => {
    onSendMessage(command.name);
    setInput("");
    onInputChange?.();
  };
  const slash = useSlashCommands(input, handleSelectCommand);

  if (pendingPrompt) {
    return (
      <div className="pt-1">
        <div className="border-border focus-within:border-primary/60 relative flex flex-col border-l-2 py-1 pl-2.5 transition-colors">
          <PromptSurface
            key={pendingPrompt.promptId}
            prompt={pendingPrompt.prompt}
            onRespond={(value) => onRespondToPrompt?.(value)}
          />
          {contextMeter}
        </div>
      </div>
    );
  }

  const isPausedPhase = phase !== "idle" && phase !== "running";

  const handleSend = () => {
    const text = input.trim();
    if (isPausedPhase) {
      onResume?.(text);
    } else {
      if (!text) return;
      onSendMessage(text);
    }
    setInput("");
    onInputChange?.();
  };

  const handleRemove = (id: string) => {
    if (onRemoveQueued?.(id)) return;
    setIsAlreadySentShown(true);
    clearTimeout(alreadySentTimerRef.current);
    alreadySentTimerRef.current = setTimeout(() => setIsAlreadySentShown(false), ALREADY_SENT_MS);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash.didHandleKey(e)) return;

    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      onCycleExecutionMode();
      return;
    }

    if (input === "" && e.key === "ArrowUp" && queuedPrompts.length > 0) {
      const text = onPopQueued?.();
      if (text === undefined) return;
      e.preventDefault();
      setInput(text);
      onInputChange?.();
      return;
    }

    if (e.key !== "Enter" || e.shiftKey) {
      return;
    }

    e.preventDefault();
    handleSend();
  };

  return (
    <div className="pt-1">
      <div className="border-border focus-within:border-primary/60 relative flex flex-col gap-2 border-l-2 py-1 pl-2.5 transition-colors">
        {slash.commands.length > 0 && (
          <SlashCommandMenu
            commands={slash.commands}
            index={slash.selectedIndex}
            onHover={slash.setIndex}
            onSelect={handleSelectCommand}
          />
        )}
        <QueuedPromptList prompts={queuedPrompts} onRemove={handleRemove} />
        <div aria-live="polite" className="text-muted-foreground text-xs empty:hidden">
          {isAlreadySentShown ? "Already sent" : statusText(phase, queuedPrompts.length)}
        </div>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            slash.resetDismissed();
            onInputChange?.();
          }}
          onKeyDown={handleKeyDown}
          placeholder={PLACEHOLDERS[phase]}
          rows={2}
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

          <div className="flex items-center gap-1.5">
            <ComposerButtons
              phase={phase}
              canSend={input.trim().length > 0}
              onSend={handleSend}
              onPause={onPause}
              onStop={onStopMessage}
            />
          </div>
        </div>
        {contextMeter}
      </div>
    </div>
  );
}
