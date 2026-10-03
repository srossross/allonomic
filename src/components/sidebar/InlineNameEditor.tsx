import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";

interface InlineNameEditorProperties {
  initialName: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}

export function InlineNameEditor({ initialName, onSave, onCancel }: InlineNameEditorProperties) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const save = (e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    if (name.trim()) onSave(name.trim());
    else onCancel();
  };

  const cancel = (e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    onCancel();
  };

  return (
    <div className="flex flex-1 items-center gap-1">
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save(e);
          else if (e.key === "Escape") cancel(e);
        }}
        onClick={(e) => e.stopPropagation()}
        className="bg-background border-border text-foreground focus:ring-primary w-full rounded-sm border px-1 py-0.5 text-xs focus:ring-1 focus:outline-none"
      />
      <button
        type="button"
        aria-label="Save name"
        onClick={save}
        className="p-0.5 text-green-500 hover:text-green-400"
      >
        <Check className="size-3" />
      </button>
      <button
        type="button"
        aria-label="Cancel rename"
        onClick={cancel}
        className="p-0.5 text-red-500 hover:text-red-400"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
