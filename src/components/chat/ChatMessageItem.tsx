import { ChevronRight, FileText, FileCode, Folder, Terminal, Wrench, X } from "lucide-react";
import type { Message, ToolCallInfo } from "@/types";

interface ChatMessageItemProperties {
  message: Message;
  isThoughtExpanded: boolean;
  onToggleThought: () => void;
  expandedToolIds: Set<string>;
  onToggleTool: (toolId: string) => void;
}

function renderToolSummary(tc: ToolCallInfo) {
  const tcArguments = tc.args ?? {};

  if (["read_file", "view_file"].includes(tc.name)) {
    const filePath = String(tcArguments.filePath || tcArguments.path || "file");
    const lineRange =
      tcArguments.startLine === undefined
        ? ""
        : `#L${tcArguments.startLine}${tcArguments.endLine === undefined ? "" : `-${tcArguments.endLine}`}`;
    return (
      <span className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">Analyzed</span>
        <FileText className="size-3.5 shrink-0 text-sky-500" />
        <span className="text-foreground font-semibold">{filePath}</span>
        {lineRange && <span className="text-muted-foreground font-mono">{lineRange}</span>}
      </span>
    );
  }
  if (["write_file", "replace_file_content", "edit_file"].includes(tc.name)) {
    const filePath = String(tcArguments.filePath || tcArguments.path || "file");
    const label = tc.status === "pending" ? "Editing" : "Edited";
    return (
      <span className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <FileCode className="size-3.5 shrink-0 text-amber-500" />
        <span className="text-foreground font-semibold">{filePath}</span>
        {tc.status === "rejected" && (
          <span className="rounded bg-destructive/20 border border-destructive/40 px-1.5 py-0.2 text-[10px] font-medium text-destructive">
            ✕ Rejected
          </span>
        )}
      </span>
    );
  }
  if (["list_files", "list_dir"].includes(tc.name)) {
    const dir = String(tcArguments.directory || ".");
    return (
      <span className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">Listed</span>
        <Folder className="size-3.5 shrink-0 text-blue-500" />
        <span className="text-foreground font-semibold">{dir}</span>
      </span>
    );
  }
  if (["run_read_only_command", "run_mutating_command", "shell", "bash"].includes(tc.name)) {
    const command = String(tcArguments.command || tcArguments.cmd || "");
    return (
      <span className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">Ran</span>
        <Terminal className="size-3.5 shrink-0 text-emerald-500" />
        <span className="text-foreground font-mono font-semibold">
          {command.length > 40 ? `${command.slice(0, 40)}...` : command}
        </span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Called</span>
      <Wrench className="text-muted-foreground size-3.5 shrink-0" />
      <span className="text-foreground font-semibold">{tc.name}</span>
    </span>
  );
}

export function ChatMessageItem({
  message,
  isThoughtExpanded,
  onToggleThought,
  expandedToolIds,
  onToggleTool,
}: ChatMessageItemProperties) {
  return (
    <div className="flex w-full flex-col items-start">
      {/* Assistant Turn: Collapsible Thinking and Tool Calls */}
      {message.role === "assistant" && (
        <div className="mb-2 w-full space-y-1 select-text">
          {/* Collapsible Thinking: "Thought for 3s ›" */}
          {message.thinking && (
            <div>
              <button
                type="button"
                onClick={onToggleThought}
                className="group text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5 py-0.5 text-xs font-normal transition-colors select-none"
              >
                <span className="text-muted-foreground group-hover:text-foreground font-normal">
                  Thought for {message.thinkingDurationSeconds ?? 3}s
                </span>
                <ChevronRight
                  className={`text-muted-foreground size-3 transition-transform duration-150 ${
                    isThoughtExpanded ? "rotate-90" : ""
                  }`}
                />
              </button>
              {isThoughtExpanded && (
                <div className="border-border/80 bg-muted/20 text-muted-foreground/90 mt-1 mb-2 max-h-60 overflow-y-auto rounded-xs border-l-2 p-2 pl-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-text">
                  {message.thinking}
                </div>
              )}
            </div>
          )}

          {/* Collapsible Tool Calls */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="space-y-1">
              {message.toolCalls.map((tc, tcIndex) => {
                const toolId = `${message.id}-tc-${tcIndex}`;
                const isExpanded = expandedToolIds.has(toolId);
                return (
                  <div key={toolId}>
                    <button
                      type="button"
                      onClick={() => onToggleTool(toolId)}
                      className="group text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5 py-0.5 text-xs font-normal transition-colors select-none"
                    >
                      {renderToolSummary(tc)}
                      <ChevronRight
                        className={`text-muted-foreground size-3 transition-transform duration-150 ${
                          isExpanded ? "rotate-90" : ""
                        }`}
                      />
                    </button>

                    {/* Rejected Badge */}
                    {tc.status === "rejected" && (
                      <div className="border-destructive/30 bg-destructive/5 my-1 flex items-center gap-1.5 rounded-xs border px-2 py-1 text-[11px] text-destructive">
                        <X className="size-3 text-destructive" />
                        <span>Write rejected by user</span>
                      </div>
                    )}

                    {isExpanded && (
                      <div className="border-border/80 bg-muted/20 mt-1 mb-2 space-y-1.5 rounded-xs border-l-2 p-2 pl-3 font-mono text-[11px] select-text">
                        {tc.args !== undefined && (
                          <div>
                            <div className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                              Parameters
                            </div>
                            <pre className="border-border/40 bg-background/60 text-foreground/80 mt-0.5 overflow-x-auto rounded-xs border p-1.5 text-[10px] whitespace-pre-wrap">
                              {typeof tc.args === "string"
                                ? tc.args
                                : JSON.stringify(tc.args, null, 2)}
                            </pre>
                          </div>
                        )}
                        {tc.result !== undefined && (
                          <div>
                            <div className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                              Result
                            </div>
                            <pre className="border-border/40 bg-background/60 text-foreground/80 mt-0.5 max-h-48 overflow-x-auto rounded-xs border p-1.5 text-[10px] whitespace-pre-wrap">
                              {typeof tc.result === "string"
                                ? tc.result
                                : JSON.stringify(tc.result, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {Boolean(message.content) && (
        <div
          className={`w-full rounded-xs px-2.5 py-1.5 text-left text-xs leading-relaxed whitespace-pre-wrap ${
            message.role === "user"
              ? "bg-primary text-primary-foreground"
              : message.content.startsWith("Error:")
                ? "border-destructive/20 bg-destructive/10 text-destructive border"
                : "border-border/50 bg-muted/40 text-foreground border"
          }`}
        >
          {message.content}
        </div>
      )}
    </div>
  );
}
