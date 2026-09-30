import { ChevronRight, FileText, FileCode, Folder, Loader2, Wrench, X } from "lucide-react";
import { isShellTool, type ToolCallInfo } from "@/types";
import { EditFileDiff } from "./EditFileDiff";
import { DIR_LIST_TOOLS, exploreSummary, FILE_READ_TOOLS, type ToolEntry } from "./exploreGroups";
import { shellCallFailed } from "./shellStatus";
import { ShellDetails, ShellSummary } from "./ShellToolCall";

function isActive(tc: ToolCallInfo) {
  return tc.status === "running" || tc.status === "pending";
}

function verb(tc: ToolCallInfo, active: string, done: string) {
  if (tc.status === "blocked") return "Blocked";
  return isActive(tc) ? active : done;
}

function renderToolSummary(tc: ToolCallInfo) {
  const tcArguments = tc.args ?? {};
  const blocked = tc.status === "blocked" ? "line-through opacity-60" : "";

  if (FILE_READ_TOOLS.has(tc.name)) {
    const filePath = String(tcArguments.filePath || tcArguments.path || "file");
    const lineRange =
      tcArguments.startLine === undefined
        ? ""
        : `#L${tcArguments.startLine}${tcArguments.endLine === undefined ? "" : `-${tcArguments.endLine}`}`;
    return (
      <span className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">{verb(tc, "Analyzing", "Analyzed")}</span>
        <FileText className="size-3.5 shrink-0 text-sky-500" />
        <span className={`text-foreground font-semibold ${blocked}`}>{filePath}</span>
        {lineRange && <span className="text-muted-foreground font-mono">{lineRange}</span>}
      </span>
    );
  }
  if (["write_file", "replace_file_content", "edit_file"].includes(tc.name)) {
    const filePath = String(tcArguments.filePath || tcArguments.path || "file");
    return (
      <span className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">{verb(tc, "Editing", "Edited")}</span>
        <FileCode className="size-3.5 shrink-0 text-amber-500" />
        <span className={`text-foreground font-semibold ${blocked}`}>{filePath}</span>
        {tc.status === "rejected" && (
          <span className="bg-destructive/20 border-destructive/40 py-0.2 text-destructive text-2xs rounded border px-1.5 font-medium">
            ✕ Rejected
          </span>
        )}
      </span>
    );
  }
  if (DIR_LIST_TOOLS.has(tc.name)) {
    const dir = String(tcArguments.directory || ".");
    return (
      <span className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">{verb(tc, "Listing", "Listed")}</span>
        <Folder className="size-3.5 shrink-0 text-blue-500" />
        <span className={`text-foreground font-semibold ${blocked}`}>{dir}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{verb(tc, "Calling", "Called")}</span>
      <Wrench className="text-muted-foreground size-3.5 shrink-0" />
      <span className={`text-foreground font-semibold ${blocked}`}>{tc.name}</span>
    </span>
  );
}

function FileContents({ tc }: { tc: ToolCallInfo }) {
  const result = typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result, null, 2);
  const preClass =
    "border-border/40 bg-background/60 text-foreground/80 max-h-96 overflow-auto rounded-xs border p-1.5 text-2xs whitespace-pre-wrap";
  if (!FILE_READ_TOOLS.has(tc.name) || result.startsWith("Error reading file")) {
    return <pre className={preClass}>{result}</pre>;
  }
  const firstLine = Number(tc.args?.startLine ?? 1);
  const lines = result.split("\n");
  const gutterWidth = `calc(${String(firstLine + lines.length - 1).length}ch + 0.5rem)`;
  return (
    <pre className={preClass}>
      {lines.map((line, index) => (
        <div key={index} className="flex">
          <span
            className="text-muted-foreground/60 shrink-0 pr-2 text-right select-none"
            style={{ width: gutterWidth }}
          >
            {firstLine + index}
          </span>
          <span className="min-w-0 flex-1">{line}</span>
        </div>
      ))}
    </pre>
  );
}

export function ToolCallRow({
  entry: { tc, toolId },
  isExpanded,
  onToggleTool,
}: {
  entry: ToolEntry;
  isExpanded: boolean;
  onToggleTool: (toolId: string) => void;
}) {
  const isShell = isShellTool(tc);
  const isFileTool = FILE_READ_TOOLS.has(tc.name) || DIR_LIST_TOOLS.has(tc.name);
  const isEdit = tc.name === "edit_file";
  return (
    <div>
      <button
        type="button"
        onClick={() => onToggleTool(toolId)}
        className={`group text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5 py-0.5 text-xs font-normal transition-colors ${
          isShell ? "w-full select-text" : "select-none"
        }`}
      >
        {isShell ? (
          <ShellSummary tc={tc} isExpanded={isExpanded} />
        ) : (
          <>
            {renderToolSummary(tc)}
            <ChevronRight
              className={`text-muted-foreground size-3 transition-transform duration-150 ${
                isExpanded ? "rotate-90" : ""
              }`}
            />
          </>
        )}
      </button>

      {tc.status === "rejected" && (
        <div className="border-destructive/30 bg-destructive/5 text-destructive my-1 flex items-center gap-1.5 rounded-xs border px-2 py-1 text-xs">
          <X className="text-destructive size-3" />
          <span>Rejected by user</span>
        </div>
      )}

      {isExpanded && (
        <div className="border-border/80 bg-muted/20 mt-1 mb-2 space-y-1.5 rounded-xs border-l-2 p-2 pl-3 font-mono text-xs select-text">
          {tc.reason && (
            <div>
              <div className="text-muted-foreground text-2xs font-semibold tracking-wider uppercase">
                Blocked
              </div>
              <pre className="border-border/40 bg-background/60 text-foreground/80 text-2xs mt-0.5 overflow-x-auto rounded-xs border p-1.5 whitespace-pre-wrap">
                {tc.reason}
              </pre>
            </div>
          )}
          {isShell && <ShellDetails tc={tc} />}
          {isFileTool && tc.result !== undefined && <FileContents tc={tc} />}
          {isEdit && <EditFileDiff tc={tc} />}
          {!isShell && !isFileTool && !isEdit && tc.args !== undefined && (
            <div>
              <div className="text-muted-foreground text-2xs font-semibold tracking-wider uppercase">
                Parameters
              </div>
              <pre className="border-border/40 bg-background/60 text-foreground/80 text-2xs mt-0.5 overflow-x-auto rounded-xs border p-1.5 whitespace-pre-wrap">
                {typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args, null, 2)}
              </pre>
            </div>
          )}
          {!isShell && !isFileTool && tc.result !== undefined && (
            <div>
              <div className="text-muted-foreground text-2xs font-semibold tracking-wider uppercase">
                Result
              </div>
              <pre className="border-border/40 bg-background/60 text-foreground/80 text-2xs mt-0.5 max-h-48 overflow-x-auto rounded-xs border p-1.5 whitespace-pre-wrap">
                {typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ExploreGroup({
  id,
  entries,
  expandedToolIds,
  onToggleTool,
}: {
  id: string;
  entries: ToolEntry[];
  expandedToolIds: Set<string>;
  onToggleTool: (toolId: string) => void;
}) {
  const isExpanded = expandedToolIds.has(id);
  const active = entries.some(({ tc }) => isActive(tc));
  const failed = entries.filter(
    ({ tc }) => tc.status === "blocked" || tc.status === "rejected" || shellCallFailed(tc)
  ).length;
  return (
    <div>
      <button
        type="button"
        onClick={() => onToggleTool(id)}
        className="group text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5 py-0.5 text-xs font-normal transition-colors select-none"
      >
        {active && <Loader2 className="text-muted-foreground size-3.5 animate-spin" />}
        <span className="text-muted-foreground">{active ? "Exploring…" : "Explored"}</span>
        <span className="text-foreground font-semibold">{exploreSummary(entries)}</span>
        {failed > 0 && <span className="text-destructive">· {failed} failed</span>}
        <ChevronRight
          className={`text-muted-foreground size-3 transition-transform duration-150 ${
            isExpanded ? "rotate-90" : ""
          }`}
        />
      </button>
      {isExpanded && (
        <div className="border-border/80 mt-1 mb-2 space-y-1 border-l-2 pl-3">
          {entries.map((entry) => (
            <ToolCallRow
              key={entry.toolId}
              entry={entry}
              isExpanded={expandedToolIds.has(entry.toolId)}
              onToggleTool={onToggleTool}
            />
          ))}
        </div>
      )}
    </div>
  );
}
