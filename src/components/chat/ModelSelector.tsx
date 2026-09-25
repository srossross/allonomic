import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronUp, Check, RefreshCw, Search, Plus, Sparkles } from "lucide-react";
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL_ID,
  type ModelOption,
  type ThinkingLevel,
} from "@/types";
import { fetchModelsApi } from "@/agent/api";
import { loadCustomModels, saveCustomModel } from "./customModels";

interface ModelSelectorProps {
  selectedModel?: string;
  onSelectModel?: (model: string) => void;
  thinkingLevel?: ThinkingLevel;
  onSelectThinkingLevel?: (level: ThinkingLevel) => void;
  models?: ModelOption[];
}

const THINKING_LEVELS: readonly ThinkingLevel[] = ["Off", "Low", "Medium", "High"] as const;

export function ModelSelector({
  selectedModel = DEFAULT_MODEL_ID,
  onSelectModel,
  thinkingLevel = "Low",
  onSelectThinkingLevel,
  models: externalModels,
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [customInput, setCustomInput] = useState("");
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<ModelOption[]>(AVAILABLE_MODELS);
  const [customModels, setCustomModels] = useState<ModelOption[]>(() => loadCustomModels());
  const menuReference = useRef<HTMLDivElement>(null);
  const searchInputReference = useRef<HTMLInputElement>(null);

  // Dynamic model loading on mount if no external models provided
  useEffect(() => {
    if (externalModels && externalModels.length > 0) return;
    let isCancelled = false;
    async function load() {
      try {
        const dynamicModels = await fetchModelsApi();
        if (!isCancelled && dynamicModels && dynamicModels.length > 0) {
          setFetchedModels(dynamicModels);
        }
      } catch {
        // Fallback already handled inside fetchModelsApi
      }
    }
    void load();
    return () => {
      isCancelled = true;
    };
  }, [externalModels]);

  const refreshModels = async () => {
    setLoadingModels(true);
    try {
      const dynamicModels = await fetchModelsApi();
      if (dynamicModels && dynamicModels.length > 0) {
        setFetchedModels(dynamicModels);
      }
    } catch {
      // Fallback handled
    } finally {
      setLoadingModels(false);
    }
  };

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
      setIsAddingCustom(false);
      setSearchQuery("");
    };

    document.addEventListener("mousedown", handleClickOutside);
    const timer = setTimeout(() => searchInputReference.current?.focus(), 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Combine external/fetched models and user-saved custom models
  const combinedModels = useMemo(() => {
    const baseList = externalModels && externalModels.length > 0 ? externalModels : fetchedModels;
    const modelMap = new Map<string, ModelOption>();

    for (const model of baseList) {
      modelMap.set(model.id, model);
    }
    for (const custom of customModels) {
      if (!modelMap.has(custom.id)) {
        modelMap.set(custom.id, custom);
      }
    }

    if (selectedModel && !modelMap.has(selectedModel)) {
      modelMap.set(selectedModel, {
        id: selectedModel,
        label: selectedModel,
        hasThinking: true,
      });
    }

    const result: ModelOption[] = [];
    modelMap.forEach((m) => {
      result.push(m);
    });
    return result;
  }, [externalModels, fetchedModels, customModels, selectedModel]);

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return combinedModels;
    const q = searchQuery.toLowerCase();
    return combinedModels.filter(
      (m) => m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
    );
  }, [combinedModels, searchQuery]);

  const currentModelObject: ModelOption =
    combinedModels.find((m) => m.id === selectedModel) || {
      id: selectedModel,
      label: selectedModel,
      hasThinking: true,
    };

  const handleCycleThinking = (e: React.MouseEvent) => {
    e.stopPropagation();
    const currentIndex = THINKING_LEVELS.indexOf(thinkingLevel);
    const nextLevel = THINKING_LEVELS[(currentIndex + 1) % THINKING_LEVELS.length];
    onSelectThinkingLevel?.(nextLevel);
  };

  const handleAddCustomModel = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customInput.trim();
    if (!trimmed) return;

    const newOption: ModelOption = {
      id: trimmed,
      label: trimmed,
      hasThinking: true,
    };

    saveCustomModel(newOption);
    setCustomModels((previous) => [...previous.filter((m) => m.id !== trimmed), newOption]);
    onSelectModel?.(trimmed);
    setCustomInput("");
    setIsAddingCustom(false);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={menuReference}>
      {/* Trigger Area with Model Label and Thinking Badge */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => setIsOpen((previous) => !previous)}
          className="text-muted-foreground hover:bg-muted/40 hover:text-foreground flex cursor-pointer items-center gap-1 rounded-xs px-1.5 py-0.5 text-xs font-normal transition-colors"
          title="Select model or thinking budget"
        >
          <span className="text-foreground font-medium">{currentModelObject.label}</span>
          <ChevronUp
            className={`text-muted-foreground size-3 transition-transform duration-150 ${
              isOpen ? "" : "rotate-180"
            }`}
          />
        </button>

        {currentModelObject.hasThinking && (
          <button
            type="button"
            onClick={handleCycleThinking}
            className="text-muted-foreground hover:bg-muted/40 hover:text-primary cursor-pointer rounded-xs px-1 py-0.5 font-mono text-[11px] font-normal transition-colors"
            title={`Thinking: ${thinkingLevel} (click to cycle)`}
          >
            {thinkingLevel}
          </button>
        )}
      </div>

      {isOpen && (
        <div
          className="border-border/80 bg-popover text-popover-foreground absolute bottom-full left-0 z-50 mb-2 w-68 rounded-xl border p-1.5 text-xs shadow-xl select-none"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header with Title and Refresh Button */}
          <div className="flex items-center justify-between px-1 py-0.5 text-[10px] font-semibold tracking-wider uppercase">
            <span className="text-muted-foreground">Model</span>
            <button
              type="button"
              onClick={refreshModels}
              disabled={loadingModels}
              className="text-muted-foreground hover:text-foreground cursor-pointer rounded-xs p-0.5 transition-colors disabled:opacity-50"
              title="Refresh models list from Google API"
            >
              <RefreshCw className={`size-3 ${loadingModels ? "animate-spin text-primary" : ""}`} />
            </button>
          </div>

          {/* Search Filter Input */}
          <div className="border-border/60 bg-muted/30 my-1 flex items-center gap-1.5 rounded-md border px-2 py-1">
            <Search className="text-muted-foreground size-3 shrink-0" />
            <input
              ref={searchInputReference}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search or filter models..."
              className="text-foreground placeholder:text-muted-foreground/60 w-full bg-transparent text-[11px] focus:outline-none"
            />
          </div>

          {/* Scrollable Model List */}
          <div className="max-h-48 space-y-0.5 overflow-y-auto pr-0.5">
            {filteredModels.length === 0 ? (
              <div className="text-muted-foreground py-2 text-center text-[11px] italic">
                No matching models found
              </div>
            ) : (
              filteredModels.map((m) => {
                const isSelected = m.id === selectedModel;
                return (
                  <div
                    key={m.id}
                    onClick={() => {
                      onSelectModel?.(m.id);
                    }}
                    className={`group flex cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-xs transition-colors ${
                      isSelected ? "bg-muted/70 font-medium" : "hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{m.label}</span>
                      {m.hasThinking && (
                        <span className="text-muted-foreground/70 flex items-center gap-0.5 text-[9px]">
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

          {/* Dedicated Thinking Level Section */}
          <div className="border-border/60 bg-muted/20 my-1.5 rounded-lg border p-1.5">
            <div className="mb-1 flex items-center justify-between px-0.5">
              <span className="text-muted-foreground font-mono text-[10px] font-semibold tracking-wider uppercase">
                Thinking Budget
              </span>
              <span className="text-primary font-mono text-[10px] font-semibold">
                {thinkingLevel}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {THINKING_LEVELS.map((lvl) => {
                const isCurrent = thinkingLevel === lvl;
                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => onSelectThinkingLevel?.(lvl)}
                    className={`cursor-pointer rounded py-1 text-center font-mono text-[10px] font-medium transition-colors ${
                      isCurrent
                        ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                        : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {lvl}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Model Input Footer */}
          <div className="border-border/60 border-t pt-1">
            {isAddingCustom ? (
              <form onSubmit={handleAddCustomModel} className="flex items-center gap-1 p-0.5">
                <input
                  type="text"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  placeholder="e.g. gemini-3.8-flash"
                  className="border-border/80 bg-background text-foreground placeholder:text-muted-foreground/60 flex-1 rounded border px-1.5 py-0.5 text-[11px] focus:outline-none"
                  autoFocus
                />
                <button
                  type="submit"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer rounded px-2 py-0.5 text-[10px] font-medium"
                >
                  Add
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setIsAddingCustom(true)}
                className="text-muted-foreground hover:bg-muted/40 hover:text-foreground flex w-full cursor-pointer items-center gap-1 rounded-sm px-2 py-1 text-left text-[11px] transition-colors"
              >
                <Plus className="size-3" />
                <span>Custom model ID...</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
