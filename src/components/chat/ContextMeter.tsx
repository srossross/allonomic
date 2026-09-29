interface ContextMeterProps {
  usedTokens?: number;
  limitTokens?: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

export function ContextMeter({ usedTokens, limitTokens }: ContextMeterProps) {
  const ratio = usedTokens !== undefined && limitTokens ? Math.min(1, usedTokens / limitTokens) : 0;
  const title =
    usedTokens === undefined
      ? "Context: no model calls yet"
      : `Context: ${formatTokens(usedTokens)} / ${limitTokens ? formatTokens(limitTokens) : "?"} tokens`;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-4 overflow-hidden rounded-b-2xl">
      <div
        title={title}
        className="bg-muted-foreground/20 pointer-events-auto absolute inset-x-0 bottom-0 h-0.75"
      >
        <div
          className={`h-full transition-[width] duration-300 ${
            ratio >= 0.9 ? "bg-red-500" : "bg-primary"
          }`}
          style={{ width: usedTokens ? `max(${ratio * 100}%, 6px)` : 0 }}
        />
      </div>
    </div>
  );
}
