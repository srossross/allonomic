import { useState } from "react";
import { X } from "lucide-react";

interface PathListProperties {
  label: string;
  inherited: string[];
  own: string[] | undefined;
  isReplacing: boolean;
  onChange: (own: string[] | undefined) => void;
}

export function PathList({ label, inherited, own, isReplacing, onChange }: PathListProperties) {
  const [draft, setDraft] = useState("");
  const base = isReplacing ? (own ?? inherited) : (own ?? []);
  const shownInherited = isReplacing && own ? [] : inherited;

  const commit = (next: string[]) => onChange(isReplacing || next.length > 0 ? next : undefined);
  const add = () => {
    const path = draft.trim();
    if (!path) return;
    commit([...base, path]);
    setDraft("");
  };

  return (
    <div className="px-2 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-foreground flex-1">{label}</span>
        {isReplacing && own && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="text-muted-foreground hover:text-foreground text-2xs cursor-pointer"
          >
            reset
          </button>
        )}
      </div>
      <ul className="mt-1 font-mono">
        {shownInherited.map((path) => (
          <li key={`i:${path}`} className="text-muted-foreground flex items-center gap-2 py-0.5">
            <span className="flex-1 truncate">{path}</span>
            {isReplacing && (
              <button
                type="button"
                onClick={() => commit(inherited.filter((p) => p !== path))}
                className="hover:text-foreground cursor-pointer"
              >
                <X className="size-3" />
              </button>
            )}
          </li>
        ))}
        {(isReplacing ? (own ?? []) : base).map((path) => (
          <li key={`o:${path}`} className="text-foreground flex items-center gap-2 py-0.5">
            <span className="flex-1 truncate">{path}</span>
            <button
              type="button"
              onClick={() => commit(base.filter((p) => p !== path))}
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="size-3" />
            </button>
          </li>
        ))}
      </ul>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        placeholder="Add path…"
        className="border-border/60 bg-background mt-1 w-full rounded-xs border px-1.5 py-0.5 font-mono text-xs"
      />
    </div>
  );
}
