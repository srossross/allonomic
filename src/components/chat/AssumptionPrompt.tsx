import { useEffect, useRef, useState } from "react";
import type { UserPrompt, UserPromptValue } from "@/types";
import { kbdClass, useKeyGuard } from "./promptKeys";

export function AssumptionPrompt({
  prompt,
  onRespond,
}: {
  prompt: Extract<UserPrompt, { kind: "assumption" }>;
  onRespond: (value: UserPromptValue) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [change, setChange] = useState("");
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const submitChange = () => {
    const value = change.trim();
    if (value) onRespond(value);
  };

  const isGuarded = useKeyGuard();
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isGuarded(e) || e.target !== e.currentTarget) return;
    if (e.key === "Enter") {
      e.preventDefault();
      onRespond(true);
      return;
    }
    if (!/^[1-9]$/.test(e.key)) return;
    const option = prompt.options[Number(e.key) - 1];
    if (option === undefined) return;
    e.preventDefault();
    onRespond(option);
  };

  const onChangeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    submitChange();
  };

  return (
    <div
      ref={ref}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-1.5 px-1.5 py-1 text-xs focus:outline-none"
    >
      <div className="text-foreground text-sm font-medium select-none">{prompt.label}</div>
      {prompt.options.length > 0 && (
        <div className="flex flex-col">
          {prompt.options.map((option, index) => (
            <button
              key={option}
              type="button"
              onClick={() => onRespond(option)}
              className="text-muted-foreground hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-left transition-colors"
            >
              <span className="text-2xs font-mono opacity-60">{index + 1}</span>
              <span>{option}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <input
          value={change}
          onChange={(e) => setChange(e.target.value)}
          onKeyDown={onChangeKeyDown}
          placeholder="Change to…"
          className="text-foreground placeholder:text-muted-foreground/60 border-border/60 flex-1 rounded border bg-transparent px-2 py-1 text-xs focus:outline-none"
        />
        <button
          type="button"
          onClick={submitChange}
          disabled={!change.trim()}
          className="border-border/60 bg-muted/60 text-muted-foreground hover:bg-muted flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          Change
        </button>
        <button
          type="button"
          onClick={() => onRespond(true)}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white shadow-xs transition-colors hover:bg-emerald-500"
        >
          <span>Confirm</span>
          <kbd className={kbdClass}>↵</kbd>
        </button>
      </div>
    </div>
  );
}
