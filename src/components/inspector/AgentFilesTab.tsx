import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AgentFileRow } from "@/types";
import type { ContextFileAgent } from "@/core/turn/events";
import { formatClock } from "@/core/turn/consoleProjection";
import { classifyPath, type PathOrigin, type PathRoots } from "@/core/contextFiles";
import { fetchPathRootsApi } from "@/agent/api";
import { toggleInSet } from "@/lib/toggleInSet";

const AGENTS: { agent: ContextFileAgent; label: string; isInterceptor: boolean }[] = [
  { agent: "worker", label: "Worker", isInterceptor: false },
  { agent: "governor", label: "Governor", isInterceptor: true },
  { agent: "teacher", label: "Teacher", isInterceptor: true },
];

const ORIGIN_BADGE: Record<PathOrigin, { label: string; className: string }> = {
  app: { label: "app", className: "bg-sky-500/15 text-sky-400" },
  ws: { label: "ws", className: "bg-emerald-500/15 text-emerald-500" },
  user: { label: "user", className: "bg-amber-500/15 text-amber-500" },
  "/": { label: "/", className: "bg-muted text-muted-foreground" },
};

function usePathRoots(workspacePath?: string): { roots: PathRoots; error?: string } {
  const [roots, setRoots] = useState<PathRoots>({});
  const [error, setError] = useState<string>();
  useEffect(() => {
    const load = async () => {
      try {
        setRoots(await fetchPathRootsApi());
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    };
    void load();
  }, []);
  return { roots: { ...roots, ws: workspacePath }, error };
}

function FileRow({ file, roots }: { file: AgentFileRow; roots: PathRoots }) {
  const { origin, relative } = classifyPath(file.path, roots);
  const badge = ORIGIN_BADGE[origin];
  const tooltip = `${file.path}\n${file.hooks.join(", ")} · ${formatClock(new Date(file.lastLoadedAt))}`;
  return (
    <div
      className="hover:bg-muted/30 flex items-center gap-2 rounded-xs px-2 py-1 font-mono text-xs"
      title={tooltip}
    >
      <span
        className={`text-2xs w-9 shrink-0 rounded-xs px-1 text-center font-semibold ${badge.className}`}
      >
        {badge.label}
      </span>
      <span className="text-foreground min-w-0 flex-1 truncate">{relative}</span>
      {file.missing && (
        <span className="text-2xs bg-destructive/15 text-destructive shrink-0 rounded-xs px-1.5 font-semibold">
          MISSING
        </span>
      )}
    </div>
  );
}

export function AgentFilesTab({
  agentFiles,
  workspacePath,
}: {
  agentFiles: AgentFileRow[];
  workspacePath?: string;
}) {
  const { roots, error } = usePathRoots(workspacePath);
  const [collapsed, setCollapsed] = useState<Set<ContextFileAgent>>(new Set());
  const missingCount = agentFiles.filter((file) => file.missing).length;

  const toggle = (agent: ContextFileAgent) =>
    setCollapsed((previous) => toggleInSet(previous, agent));

  return (
    <div className="space-y-2">
      {error && (
        <div className="text-destructive p-3 font-mono text-xs">
          Failed to resolve path roots: {error}
        </div>
      )}
      <div className="flex items-center justify-between px-1 text-xs">
        <span className="text-muted-foreground text-2xs font-mono font-semibold tracking-wider uppercase">
          Agent Files ({agentFiles.length})
        </span>
        {missingCount > 0 && (
          <span className="text-2xs text-destructive font-mono font-medium">
            {missingCount} missing
          </span>
        )}
      </div>

      {agentFiles.length === 0 ? (
        <div className="text-muted-foreground p-3 font-mono text-xs">No files loaded yet.</div>
      ) : (
        AGENTS.map(({ agent, label, isInterceptor }) => {
          const files = agentFiles.filter((file) => file.agent === agent);
          if (files.length === 0) return null;
          const isOpen = !collapsed.has(agent);
          return (
            <div key={agent}>
              <button
                type="button"
                onClick={() => toggle(agent)}
                className="hover:bg-muted/30 flex w-full cursor-pointer items-center gap-1.5 rounded-xs px-1 py-1 text-left"
              >
                <ChevronDown
                  className={`text-muted-foreground size-3.5 shrink-0 transition-transform ${isOpen ? "" : "-rotate-90"}`}
                />
                <span className="text-foreground text-2xs font-mono font-semibold tracking-wider uppercase">
                  {label}
                </span>
                {isInterceptor && (
                  <span className="text-2xs rounded-xs bg-purple-500/15 px-1.5 leading-none font-semibold text-purple-400">
                    interceptor
                  </span>
                )}
                <span className="text-muted-foreground text-2xs ml-auto font-mono">
                  {files.length}
                </span>
              </button>
              {isOpen && (
                <div className="space-y-0.5">
                  {files.map((file) => (
                    <FileRow key={file.path} file={file} roots={roots} />
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
