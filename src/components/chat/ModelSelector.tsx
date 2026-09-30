import { useState, useRef, useEffect, useMemo } from "react";
import { Brain, ChevronUp, Check, Search, Sparkles } from "lucide-react";
import { DEFAULT_MODEL_ID, THINKING_LEVELS, type ModelOption, type ThinkingLevel } from "@/types";
import { activateOnKey } from "@/lib/activateOnKey";

type ModelChoice = Pick<ModelOption, "id" | "label" | "thinking">;

interface ModelSelectorProps {
  selectedModel?: string;
  onSelectModel?: (model: string) => void;
  thinkingLevel?: ThinkingLevel;
  onSelectThinkingLevel?: (level: ThinkingLevel) => void;
  models?: ModelOption[];
}

export function ModelSelector({
  selectedModel = DEFAULT_MODEL_ID,
  onSelectModel,
  thinkingLevel = "Low",
  onSelectThinkingLevel,
  models = [],
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const menuReference = useRef<HTMLDivElement>(null);
  const searchInputReference = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        !menuReference.current ||
        !(e.target instanceof Node) ||
        menuReference.current.contains(e.target)
      ) {
        return;
      }
      setIsOpen(false);
      setSearchQuery("");
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setIsOpen(false);
      setSearchQuery("");
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    const timer = setTimeout(() => searchInputReference.current?.focus(), 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const currentModelObject = useMemo(
    (): ModelChoice =>
      models.find((m) => m.id === selectedModel) ?? {
        id: selectedModel,
        label: selectedModel,
        thinking: [...THINKING_LEVELS],
      },
    [models, selectedModel]
  );

  const combinedModels = useMemo(
    (): ModelChoice[] =>
      models.some((m) => m.id === selectedModel) ? models : [...models, currentModelObject],
    [models, selectedModel, currentModelObject]
  );

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return combinedModels;
    const q = searchQuery.toLowerCase();
    return combinedModels.filter(
      (m) => m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
    );
  }, [combinedModels, searchQuery]);

  const handleCycleThinking = (e: React.MouseEvent) => {
    e.stopPropagation();
    const levels = currentModelObject.thinking;
    const nextLevel = levels[(levels.indexOf(thinkingLevel) + 1) % levels.length];
    onSelectThinkingLevel?.(nextLevel);
  };

  return (
    <div className="relative" ref={menuReference}>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => setIsOpen((previous) => !previous)}
          className="text-muted-foreground hover:bg-muted/40 hover:text-foreground flex cursor-pointer items-center gap-1 rounded-xs px-1.5 py-0.5 text-xs font-normal transition-colors"
          title="Select model"
        >
          <span className="text-foreground font-medium">{currentModelObject.label}</span>
          <ChevronUp
            className={`text-muted-foreground size-3 transition-transform duration-150 ${
              isOpen ? "" : "rotate-180"
            }`}
          />
        </button>

        {currentModelObject.thinking.length > 0 && (
          <button
            type="button"
            onClick={handleCycleThinking}
            className="text-muted-foreground hover:bg-muted/40 hover:text-primary flex cursor-pointer items-center gap-1 rounded-xs px-1 py-0.5 text-xs transition-colors"
            title={`Thinking: ${thinkingLevel} (click to cycle)`}
          >
            <Brain className="size-3.5" />
            <span className="flex items-center gap-0.5">
              {[1, 2, 3].map((dot) => (
                <span
                  key={dot}
                  className={`size-1 rounded-full ${
                    dot <= THINKING_LEVELS.indexOf(thinkingLevel)
                      ? "bg-current"
                      : "border border-current opacity-50"
                  }`}
                />
              ))}
            </span>
          </button>
        )}
      </div>

      {isOpen && (
        <div
          className="border-border/80 bg-popover text-popover-foreground absolute bottom-full left-0 z-50 mb-2 w-68 rounded-xl border p-1.5 text-xs shadow-xl select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-2xs px-1 py-0.5 font-semibold tracking-wider uppercase">
            <span className="text-muted-foreground">Model</span>
          </div>

          <div className="border-border/60 bg-muted/30 my-1 flex items-center gap-1.5 rounded-md border px-2 py-1">
            <Search className="text-muted-foreground size-3 shrink-0" />
            <input
              ref={searchInputReference}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search or filter models..."
              className="text-foreground placeholder:text-muted-foreground/60 w-full bg-transparent text-xs focus:outline-none"
            />
          </div>

          <div role="listbox" className="max-h-48 space-y-0.5 overflow-y-auto pr-0.5">
            {filteredModels.length === 0 ? (
              <div className="text-muted-foreground py-2 text-center text-xs italic">
                No matching models found
              </div>
            ) : (
              filteredModels.map((m) => {
                const isSelected = m.id === selectedModel;
                return (
                  <div
                    key={m.id}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={0}
                    onClick={() => {
                      onSelectModel?.(m.id);
                    }}
                    onKeyDown={activateOnKey(() => onSelectModel?.(m.id))}
                    className={`group flex cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-xs transition-colors ${
                      isSelected ? "bg-muted/70 font-medium" : "hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{m.label}</span>
                      {m.thinking.length > 0 && (
                        <span className="text-muted-foreground/70 text-2xs flex items-center gap-0.5">
                          <Sparkles className="size-2.5 opacity-60" />
                        </span>
                      )}
                    </div>
                    {isSelected && <Check className="text-primary size-3 shrink-0" />}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
