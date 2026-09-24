import { useState, useRef, useEffect } from "react";
import { ChevronUp, Check } from "lucide-react";
import { AVAILABLE_MODES, type ExecutionMode, type ModeOption } from "@/types";

interface ModeSelectorProps {
  executionMode?: ExecutionMode;
  onSelectExecutionMode?: (mode: ExecutionMode) => void;
}

export function ModeSelector({
  executionMode = "manual",
  onSelectExecutionMode,
}: ModeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
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

  const currentModeObject: ModeOption =
    AVAILABLE_MODES.find((m) => m.id === executionMode) || AVAILABLE_MODES[0];

  const isAcceptEdits = executionMode === "accept edits";

  return (
    <div className="relative" ref={menuReference}>
      <button
        type="button"
        onClick={() => setIsOpen((previous) => !previous)}
        className={`flex cursor-pointer items-center gap-1 rounded-xs px-1.5 py-0.5 text-xs transition-colors ${
          isAcceptEdits
            ? "font-medium text-purple-400 hover:bg-purple-500/15"
            : "text-muted-foreground/60 hover:bg-muted/40 hover:text-muted-foreground font-normal"
        }`}
        title="Execution mode (Shift+Tab to cycle)"
      >
        <span
          className={
            isAcceptEdits ? "font-medium text-purple-400" : "text-muted-foreground/70 font-medium"
          }
        >
          {currentModeObject.label}
        </span>
        <ChevronUp
          className={`size-3 transition-transform duration-150 ${
            isAcceptEdits ? "text-purple-400/80" : "text-muted-foreground/50"
          } ${isOpen ? "" : "rotate-180"}`}
        />
      </button>

      {isOpen && (
        <div
          className="border-border/80 bg-popover text-popover-foreground absolute bottom-full left-0 z-50 mb-2 w-52 rounded-xl border p-1 text-xs shadow-xl select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
              Mode
            </span>
            <kbd className="text-muted-foreground/80 bg-muted/60 border-border/70 py-0.2 rounded border px-1 font-mono text-[9px]">
              ⇧Tab
            </kbd>
          </div>

          <div className="space-y-0.5">
            {AVAILABLE_MODES.map((m) => {
              const isSelected = m.id === executionMode;
              const isPurple = m.id === "accept edits";

              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onSelectExecutionMode?.(m.id);
                    setIsOpen(false);
                  }}
                  className={`flex w-full cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-left text-xs transition-colors ${
                    isSelected
                      ? isPurple
                        ? "bg-purple-500/15 font-medium text-purple-300"
                        : "bg-muted/60 text-muted-foreground font-medium"
                      : isPurple
                        ? "text-purple-400/80 hover:bg-purple-500/10 hover:text-purple-300"
                        : "text-muted-foreground/70 hover:bg-muted/40 hover:text-muted-foreground"
                  }`}
                >
                  <div className="flex flex-col">
                    <span
                      className={`truncate ${
                        isPurple
                          ? isSelected
                            ? "font-medium text-purple-400"
                            : "text-purple-400/80"
                          : isSelected
                            ? "text-muted-foreground font-medium"
                            : "text-muted-foreground/70"
                      }`}
                    >
                      {m.label}
                    </span>
                    {m.description && (
                      <span
                        className={`text-[10px] font-normal ${
                          isPurple ? "text-purple-400/60" : "text-muted-foreground/50"
                        }`}
                      >
                        {m.description}
                      </span>
                    )}
                  </div>
                  {isSelected && (
                    <Check
                      className={`size-3 shrink-0 ${
                        isPurple ? "text-purple-400" : "text-muted-foreground"
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
