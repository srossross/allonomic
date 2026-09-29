import { useEffect, useRef, useState } from "react";
import type { ExecutionMode, UserPrompt, UserPromptValue } from "@/types";
import { MODE_STYLES } from "./modeStyles";

interface PromptSurfaceProps {
  prompt: UserPrompt;
  onRespond: (value: UserPromptValue) => void;
}

const kbdClass =
  "border-border/60 bg-muted/60 text-current rounded border px-1 py-0.5 font-mono text-2xs font-semibold";

export function PromptSurface({ prompt, onRespond }: PromptSurfaceProps) {
  switch (prompt.kind) {
    case "confirm": {
      return <ConfirmPrompt prompt={prompt} onRespond={onRespond} />;
    }
    case "choice": {
      return <ChoicePrompt prompt={prompt} onRespond={onRespond} />;
    }
    case "text": {
      return <TextPrompt prompt={prompt} onRespond={onRespond} />;
    }
  }
}

function ConfirmPrompt({
  prompt,
  onRespond,
}: {
  prompt: Extract<UserPrompt, { kind: "confirm" }>;
  onRespond: (isConfirmed: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      onRespond(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onRespond(false);
    }
  };

  return (
    <div
      ref={ref}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-2 px-1.5 py-1 text-xs select-none focus:outline-none"
    >
      {prompt.mode && prompt.currentMode && (
        <div className="text-foreground text-sm font-medium">
          Needs <span className={MODE_STYLES[prompt.mode].label}>{prompt.mode}</span> mode to run
          without a prompt (currently{" "}
          <span className={MODE_STYLES[prompt.currentMode].label}>{prompt.currentMode}</span>)
        </div>
      )}
      <div className="flex items-baseline gap-2">
        <span className="text-foreground font-mono font-semibold break-all">{prompt.label}</span>
        {prompt.detail && <span className="text-muted-foreground">{prompt.detail}</span>}
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => onRespond(false)}
          className="border-border/60 bg-muted/60 text-muted-foreground hover:bg-destructive/20 hover:text-destructive flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors"
        >
          <span>No</span>
          <kbd className={kbdClass}>esc</kbd>
        </button>
        <button
          type="button"
          onClick={() => onRespond(true)}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white shadow-xs transition-colors hover:bg-emerald-500"
        >
          <span>Yes</span>
          <kbd className={kbdClass}>↵</kbd>
        </button>
      </div>
    </div>
  );
}

function ModeLabel({ label, mode }: { label: string; mode?: ExecutionMode }) {
  const index = mode ? label.lastIndexOf(mode) : -1;
  if (!mode || index === -1) return label;
  return (
    <>
      {label.slice(0, index)}
      <span className={MODE_STYLES[mode].label}>{mode}</span>
      {label.slice(index + mode.length)}
    </>
  );
}

function ChoicePrompt({
  prompt,
  onRespond,
}: {
  prompt: Extract<UserPrompt, { kind: "choice" }>;
  onRespond: (v: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const n = prompt.options.length;
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        setIndex((i) => (i + 1) % n);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        setIndex((i) => (i - 1 + n) % n);
        break;
      }
      case "Enter": {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        onRespond(prompt.options[index].value);
        break;
      }
      default: {
        if (!/^[1-9]$/.test(e.key)) return;
        const i = Number(e.key) - 1;
        if (i < n) {
          e.preventDefault();
          onRespond(prompt.options[i].value);
        }
      }
    }
  };

  return (
    <div
      ref={ref}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-1.5 px-1.5 py-1 text-xs select-none focus:outline-none"
    >
      <div className="text-foreground text-sm font-medium">
        <ModeLabel label={prompt.label} mode={prompt.mode} />
      </div>
      {prompt.detail && (
        <div className="text-muted-foreground whitespace-pre-wrap">{prompt.detail}</div>
      )}
      <div className="flex flex-col">
        {prompt.options.map((o, i) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onRespond(o.value)}
            onMouseEnter={() => setIndex(i)}
            className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-left transition-colors ${
              i === index ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <span className="text-2xs font-mono opacity-60">{i + 1}</span>
            <span>{o.label}</span>
          </button>
        ))}
      </div>
      <div className="text-muted-foreground text-2xs flex justify-end gap-1">
        <kbd className={kbdClass}>↑↓</kbd>
        <kbd className={kbdClass}>↵</kbd>
      </div>
    </div>
  );
}

function TextPrompt({
  prompt,
  onRespond,
}: {
  prompt: Extract<UserPrompt, { kind: "text" }>;
  onRespond: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const submit = () => {
    const v = value.trim();
    if (v) onRespond(v);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setValue("");
    }
  };

  return (
    <div className="flex flex-col gap-1.5 px-1.5 py-1 text-xs">
      <div className="text-foreground font-medium select-none">{prompt.label}</div>
      <div className="flex items-center gap-1.5">
        <input
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={prompt.placeholder}
          className="text-foreground placeholder:text-muted-foreground/60 border-border/60 flex-1 rounded border bg-transparent px-2 py-1 text-xs focus:outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim()}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white shadow-xs transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>Submit</span>
          <kbd className={kbdClass}>↵</kbd>
        </button>
      </div>
    </div>
  );
}
