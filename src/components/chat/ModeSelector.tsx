import { useState, useRef, useEffect } from "react";
import { ChevronUp, Check } from "lucide-react";
import {
  AVAILABLE_MODES,
  DEFAULT_EXECUTION_MODE,
  type ExecutionMode,
  type ModeOption,
} from "@/types";
import { MODE_STYLES } from "./modeStyles";

interface ModeSelectorProps {
  executionMode?: ExecutionMode;
  onSelectExecutionMode?: (mode: ExecutionMode) => void;
}

export function ModeSelector({
  executionMode = DEFAULT_EXECUTION_MODE,
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

  const current = MODE_STYLES[currentModeObject.id];

  return (
    <div className="relative" ref={menuReference}>
      <button
        type="button"
        onClick={() => setIsOpen((previous) => !previous)}
        className={`flex cursor-pointer items-center gap-1 rounded-xs px-1.5 py-0.5 text-xs transition-colors ${current.trigger}`}
        title="Execution mode (Shift+Tab to cycle)"
      >
        <span className={current.label}>{currentModeObject.label}</span>
        <ChevronUp
          className={`size-3 transition-transform duration-150 ${current.chevron} ${
            isOpen ? "" : "rotate-180"
          }`}
        />
      </button>

      {isOpen && (
        <div
          className="border-border/80 bg-popover text-popover-foreground absolute bottom-full left-0 z-50 mb-2 w-52 rounded-xl border p-1 text-xs shadow-xl select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-muted-foreground text-2xs font-semibold tracking-wider uppercase">
              Mode
            </span>
            <kbd className="text-muted-foreground/80 bg-muted/60 border-border/70 py-0.2 text-2xs rounded border px-1 font-mono">
              ⇧Tab
            </kbd>
          </div>

          <div className="space-y-0.5">
            {AVAILABLE_MODES.map((m) => {
              const isSelected = m.id === executionMode;
              const style = MODE_STYLES[m.id];

              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onSelectExecutionMode?.(m.id);
                    setIsOpen(false);
                  }}
                  className={`flex w-full cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-left text-xs transition-colors ${
                    isSelected ? style.itemSelected : style.item
                  }`}
                >
                  <div className="flex flex-col">
                    <span
                      className={`truncate ${isSelected ? style.itemLabelSelected : style.itemLabel}`}
                    >
                      {m.label}
                    </span>
                    {m.description && (
                      <span className={`text-2xs font-normal ${style.description}`}>
                        {m.description}
                      </span>
                    )}
                  </div>
                  {isSelected && <Check className={`size-3 shrink-0 ${style.check}`} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
