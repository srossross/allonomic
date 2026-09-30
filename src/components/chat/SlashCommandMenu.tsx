import type { SlashCommand } from "./useSlashCommands";

export function SlashCommandMenu({
  commands,
  index,
  onHover,
  onSelect,
}: {
  commands: SlashCommand[];
  index: number;
  onHover: (index: number) => void;
  onSelect: (command: SlashCommand) => void;
}) {
  return (
    <div className="border-border bg-background absolute right-0 bottom-full left-0 mb-1 flex flex-col rounded border p-1 text-xs shadow-sm">
      {commands.map((c, i) => (
        <button
          key={c.name}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(c)}
          onMouseEnter={() => onHover(i)}
          className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-left transition-colors ${
            i === index ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"
          }`}
        >
          <span className="font-mono">{c.name}</span>
          <span className="opacity-60">{c.description}</span>
        </button>
      ))}
    </div>
  );
}
