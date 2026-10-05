import type { ReactNode } from "react";
import { GitFork, Undo2 } from "lucide-react";

function ActionButton({
  title,
  isDisabled = false,
  onClick,
  children,
}: {
  title: string;
  isDisabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      aria-disabled={isDisabled}
      title={title}
      onClick={isDisabled ? undefined : onClick}
      className={`flex size-5 items-center justify-center rounded-xs transition-colors ${
        isDisabled
          ? "cursor-not-allowed opacity-40"
          : "hover:bg-primary-foreground/20 cursor-pointer opacity-70 hover:opacity-100"
      }`}
    >
      {children}
    </button>
  );
}

export function UserMessageActions({
  onRewind,
  onFork,
  isRewindDisabled,
}: {
  onRewind?: () => void;
  onFork?: () => void;
  isRewindDisabled: boolean;
}) {
  return (
    <div className="invisible absolute top-1 right-1 flex gap-0.5 group-hover:visible">
      {onRewind && (
        <ActionButton
          title={isRewindDisabled ? "Can't rewind while a turn is running" : "Rewind to here"}
          isDisabled={isRewindDisabled}
          onClick={onRewind}
        >
          <Undo2 className="size-3" />
        </ActionButton>
      )}
      {onFork && (
        <ActionButton title="Fork into new tab" onClick={onFork}>
          <GitFork className="size-3" />
        </ActionButton>
      )}
    </div>
  );
}
