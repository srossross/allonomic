import type { ContextMessage } from "@/types";

interface ContextViewProperties {
  contextList: ContextMessage[];
}

export function ContextView({ contextList }: ContextViewProperties) {
  if (contextList.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center font-mono text-xs">
        No active context yet. Send a prompt to view the worker agent context.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="border-border/40 text-muted-foreground flex items-center justify-between border-b pb-1 font-mono text-[11px]">
        <span>Active Worker Context</span>
        <span className="text-muted-foreground/70 text-[10px]">Interception loops excluded</span>
      </div>

      {contextList.map((message, index) => (
        <div
          key={index}
          className="border-border/60 bg-muted/20 space-y-1.5 rounded-xs border p-2 font-mono text-xs"
        >
          {/* Header: Role badge & Name */}
          <div className="flex items-center justify-between text-[10px]">
            <span
              className={`rounded-xs px-1.5 py-0.5 font-semibold tracking-wider uppercase ${
                message.role === "system"
                  ? "bg-muted text-muted-foreground"
                  : message.role === "human" || message.role === "user"
                    ? "bg-sky-500/15 text-sky-400"
                    : message.role === "ai" || message.role === "assistant"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : message.role === "tool"
                        ? "bg-purple-500/15 text-purple-400"
                        : "bg-muted text-muted-foreground"
              }`}
            >
              {message.role}
              {message.name ? `: ${message.name}` : ""}
            </span>
            <span className="text-muted-foreground/60 text-[10px]">#{index + 1}</span>
          </div>

          {/* Thinking trace if present */}
          {message.thinking && (
            <div className="rounded-xs border border-purple-500/30 bg-purple-500/10 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-purple-200/90 select-text">
              <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-purple-400">
                <span>Thought Process</span>
              </div>
              {message.thinking}
            </div>
          )}

          {/* Content */}
          {(() => {
            let displayContent = "";
            if (typeof message.content === "string") {
              displayContent = message.content;
            } else if (Array.isArray(message.content)) {
              const textParts = message.content
                .filter(
                  (p: unknown): p is { type?: string; thought?: boolean; text?: string } =>
                    typeof p === "object" &&
                    p !== null &&
                    !("thought" in p && p.thought) &&
                    !("type" in p && p.type === "thought")
                )
                .map((p) => (p.text === undefined ? JSON.stringify(p) : String(p.text)))
                .join("\n");
              displayContent =
                textParts || (message.thinking ? "" : JSON.stringify(message.content, null, 2));
            } else if (message.content) {
              displayContent = JSON.stringify(message.content, null, 2);
            }

            return displayContent ? (
              <div className="text-foreground/90 max-h-60 overflow-y-auto text-[11px] leading-relaxed whitespace-pre-wrap select-text">
                {displayContent}
              </div>
            ) : null;
          })()}

          {/* Tool Calls if any */}
          {message.tool_calls && message.tool_calls.length > 0 && (
            <div className="border-border/40 space-y-1 border-t pt-1">
              <span className="text-primary/80 text-[10px] font-semibold tracking-wider uppercase">
                Tool Calls:
              </span>
              {message.tool_calls.map((tc, tcIndex) => (
                <div
                  key={tcIndex}
                  className="border-border/40 bg-background/60 text-foreground/80 space-y-0.5 rounded-xs border p-1.5 text-[10px] select-text"
                >
                  <div className="text-primary font-semibold">{tc.name}</div>
                  <pre className="overflow-x-auto text-[10px]">
                    {JSON.stringify(tc.args, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
