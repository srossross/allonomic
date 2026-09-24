interface ChatHeaderProperties {
  showContext: boolean;
  contextCount: number;
  loading: boolean;
  onToggleContext?: () => void;
}

export function ChatHeader({
  showContext,
  contextCount,
  loading,
  onToggleContext,
}: ChatHeaderProperties) {
  return (
    <div className="border-border/80 flex h-9 items-center justify-between border-b px-3 text-xs select-none">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-foreground font-medium">
          {showContext ? "Context (Worker LLM)" : "Chat"}
        </span>
        {showContext && (
          <span className="bg-muted/50 text-muted-foreground rounded-xs px-1.5 py-0.5 font-mono text-[10px]">
            {contextCount} msgs
          </span>
        )}
        {loading && (
          <span className="text-muted-foreground animate-pulse truncate font-mono text-[11px]">
            Agent running with Governor...
          </span>
        )}
      </div>

      {onToggleContext && (
        <button
          type="button"
          onClick={onToggleContext}
          className={`flex cursor-pointer items-center gap-1 rounded-xs px-1.5 py-0.5 font-mono text-[11px] leading-none transition-colors ${
            showContext
              ? "bg-primary text-primary-foreground font-semibold"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          }`}
          title={
            showContext
              ? "Switch to standard Chat view"
              : "Show Full Worker LLM Context (excluding Interceptors)"
          }
        >
          {"</>"}
        </button>
      )}
    </div>
  );
}
