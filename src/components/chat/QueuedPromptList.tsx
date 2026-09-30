import { X } from "lucide-react";
import type { QueuedPrompt } from "@/core/graph/turnControl";

export function QueuedPromptList({
  prompts,
  onRemove,
}: {
  prompts: QueuedPrompt[];
  onRemove: (id: string) => void;
}) {
  if (prompts.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1" aria-label="Queued messages">
      {prompts.map((queued) => (
        <li
          key={queued.id}
          className="border-border/60 bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-xs border px-2 py-1 text-xs"
        >
          <span className="text-2xs font-mono uppercase opacity-60">queued</span>
          <span className="flex-1 truncate">{queued.text}</span>
          <button
            type="button"
            onClick={() => onRemove(queued.id)}
            className="hover:text-foreground cursor-pointer"
            aria-label={`Remove queued message: ${queued.text}`}
          >
            <X className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}
