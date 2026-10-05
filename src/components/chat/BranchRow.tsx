import { ChevronLeft, ChevronRight, GitBranch, Undo2 } from "lucide-react";

const ICON_BUTTON =
  "flex size-5 cursor-pointer items-center justify-center rounded-xs hover:bg-foreground/10 hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent";

export function BranchSwitcher({
  branches,
  active,
  isDisabled,
  onSelect,
}: {
  branches: number[];
  active: number;
  isDisabled: boolean;
  onSelect: (turn: number) => void;
}) {
  const index = branches.indexOf(active);
  return (
    <div className="text-muted-foreground flex items-center justify-end gap-0.5 text-xs">
      <GitBranch className="mr-1 size-3" />
      <button
        type="button"
        aria-label="Previous branch"
        title="Previous branch"
        disabled={isDisabled || index === 0}
        onClick={() => onSelect(branches[index - 1])}
        className={ICON_BUTTON}
      >
        <ChevronLeft className="size-3.5" />
      </button>
      <span className="tabular-nums">
        {index + 1} / {branches.length}
      </span>
      <button
        type="button"
        aria-label="Next branch"
        title="Next branch"
        disabled={isDisabled || index === branches.length - 1}
        onClick={() => onSelect(branches[index + 1])}
        className={ICON_BUTTON}
      >
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  );
}

export function RewoundMarker({ isDisabled, onUndo }: { isDisabled: boolean; onUndo: () => void }) {
  return (
    <div className="text-muted-foreground flex items-center gap-2 py-1 text-xs">
      <div className="bg-border h-px flex-1" />
      <span>Rewound</span>
      <button
        type="button"
        disabled={isDisabled}
        onClick={onUndo}
        className="hover:bg-foreground/10 hover:text-foreground flex cursor-pointer items-center gap-1 rounded-xs px-1.5 py-0.5 disabled:cursor-default disabled:opacity-40"
      >
        <Undo2 className="size-3" />
        <span>Undo</span>
      </button>
      <div className="bg-border h-px flex-1" />
    </div>
  );
}
