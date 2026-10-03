import type { ReactNode } from "react";

export function StreamRow({
  status,
  icon,
  iconTitle,
  isExpanded,
  onToggle,
  striped = false,
  selectable = false,
  children,
}: {
  status?: ReactNode;
  icon: ReactNode;
  iconTitle?: string;
  striped?: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  selectable?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="-mx-3 min-w-0 flex-1 self-stretch">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className={`group text-muted-foreground hover:bg-foreground/10 hover:text-foreground flex w-full min-w-0 cursor-pointer items-start gap-2 px-3 py-0.5 text-left text-xs font-normal transition-colors ${
          isExpanded ? "bg-foreground/8" : striped ? "bg-foreground/5" : ""
        } ${selectable ? "select-text" : "select-none"}`}
      >
        {status && (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{status}</span>
        )}
        <span className="min-w-0 flex-1 leading-4">{children}</span>
        <span className="flex h-4 w-4 shrink-0 items-center justify-center" title={iconTitle}>
          {icon}
        </span>
      </button>
    </div>
  );
}
