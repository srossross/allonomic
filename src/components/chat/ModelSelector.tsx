import { useState, useRef, useEffect } from "react";
import { ChevronUp, ChevronRight, Check } from "lucide-react";
import { AVAILABLE_MODELS, type ModelOption, type ThinkingLevel } from "@/types";

interface ModelSelectorProps {
  selectedModel?: string;
  onSelectModel?: (model: string) => void;
  thinkingLevel?: ThinkingLevel;
  onSelectThinkingLevel?: (level: ThinkingLevel) => void;
}

export function ModelSelector({
  selectedModel = "gemini-2.5-flash",
  onSelectModel,
  thinkingLevel = "High",
  onSelectThinkingLevel,
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredModelId, setHoveredModelId] = useState<string | null>(null);
  const menuReference = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        e.target instanceof Node &&
        menuReference.current &&
        !menuReference.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const currentModelObject: ModelOption =
    AVAILABLE_MODELS.find((m) => m.id === selectedModel) || AVAILABLE_MODELS[0];

  return (
    <div className="relative" ref={menuReference}>
      <button
        type="button"
        onClick={() => setIsOpen((previous) => !previous)}
        className="text-muted-foreground hover:bg-muted/40 hover:text-foreground flex cursor-pointer items-center gap-1 rounded-xs px-1.5 py-0.5 text-xs font-normal transition-colors"
      >
        <span className="text-foreground font-medium">{currentModelObject.label}</span>
        {currentModelObject.hasThinking && (
          <span className="text-muted-foreground text-[11px] font-normal">{thinkingLevel}</span>
        )}
        <ChevronUp
          className={`text-muted-foreground size-3 transition-transform duration-150 ${
            isOpen ? "" : "rotate-180"
          }`}
        />
      </button>

      {isOpen && (
        <div
          className="border-border/80 bg-popover text-popover-foreground absolute bottom-full left-0 z-50 mb-2 w-60 rounded-xl border p-1 text-xs shadow-xl select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-muted-foreground px-2 py-1 text-[10px] font-semibold tracking-wider uppercase">
            Model
          </div>

          <div className="space-y-0.5">
            {AVAILABLE_MODELS.map((m) => {
              const isSelected = m.id === selectedModel;
              return (
                <div
                  key={m.id}
                  onMouseEnter={() => setHoveredModelId(m.id)}
                  onClick={() => {
                    onSelectModel?.(m.id);
                    setIsOpen(false);
                  }}
                  className={`group relative flex cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-xs transition-colors ${
                    isSelected ? "bg-muted/70 font-medium" : "hover:bg-muted/40"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{m.label}</span>
                    {m.hasThinking && isSelected && (
                      <span className="text-muted-foreground text-[10px] font-normal">
                        {thinkingLevel}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 text-[10px]">
                    {m.hasThinking && <ChevronRight className="text-muted-foreground size-3" />}
                    {isSelected && <Check className="text-primary size-3 shrink-0" />}
                  </div>

                  {hoveredModelId === m.id && m.hasThinking && (
                    <div
                      className="border-border/80 bg-popover absolute top-0 left-full z-50 ml-1.5 w-28 rounded-lg border p-1 text-xs shadow-xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {(["Low", "Medium", "High", "Off"] as const).map((lvl) => (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => {
                            onSelectModel?.(m.id);
                            onSelectThinkingLevel?.(lvl);
                            setIsOpen(false);
                          }}
                          className={`flex w-full cursor-pointer items-center justify-between rounded-xs px-2 py-1 text-left transition-colors ${
                            isSelected && thinkingLevel === lvl
                              ? "bg-muted/70 text-foreground font-medium"
                              : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                          }`}
                        >
                          <span>{lvl}</span>
                          {isSelected && thinkingLevel === lvl && (
                            <Check className="text-primary size-3" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
