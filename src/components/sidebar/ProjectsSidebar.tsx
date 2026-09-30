import { useRef, useState, useEffect } from "react";
import { Folder, FolderPlus, MoreVertical, Pencil, Trash2, Check, X } from "lucide-react";
import type { Project } from "@/types";
import { activateOnKey } from "@/lib/activateOnKey";
import { tildify } from "@/lib/tildify";

interface ProjectState {
  agentState: "idle" | "running" | "awaiting";
  hasUnread: boolean;
}

interface ProjectsSidebarProperties {
  projects: Project[];
  activeProjectId: string;
  onSelectProject: (projectId: string) => void;
  onOpenDirPicker: () => void;
  onRenameProject: (projectId: string, newName: string) => void;
  onDeleteProject: (projectId: string) => void;
  projectStates?: Record<string, ProjectState>;
}

export function ProjectsSidebar({
  projects,
  activeProjectId,
  onSelectProject,
  onOpenDirPicker,
  onRenameProject,
  onDeleteProject,
  projectStates,
}: ProjectsSidebarProperties) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const [isCommandHeld, setIsCommandHeld] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => setIsCommandHeld(e.metaKey);
    const handleBlur = () => setIsCommandHeld(false);
    globalThis.addEventListener("keydown", handleKey);
    globalThis.addEventListener("keyup", handleKey);
    globalThis.addEventListener("blur", handleBlur);
    return () => {
      globalThis.removeEventListener("keydown", handleKey);
      globalThis.removeEventListener("keyup", handleKey);
      globalThis.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingId]);

  const handleStartEdit = (e: React.MouseEvent, proj: Project) => {
    e.stopPropagation();
    setEditingId(proj.id);
    setEditName(proj.name);
    setMenuOpenId(null);
  };

  const handleSaveEdit = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation();
    if (editingId && editName.trim()) {
      onRenameProject(editingId, editName.trim());
    }
    setEditingId(null);
  };

  const handleCancelEdit = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation();
    setEditingId(null);
  };

  const handleDelete = (e: React.MouseEvent, projId: string) => {
    e.stopPropagation();
    onDeleteProject(projId);
    setMenuOpenId(null);
  };

  return (
    <aside className="border-border/80 bg-muted/20 flex h-full w-56 flex-col border-r text-xs select-none">
      <div className="border-border/80 flex h-9 items-center justify-between border-b px-3">
        <div className="flex items-center gap-1.5">
          <span className="text-foreground text-xs font-semibold tracking-tight">
            {projects.find((p) => p.id === activeProjectId)?.name || "atomic"}
          </span>
          <span className="text-muted-foreground/60 text-2xs font-mono">/ projects</span>
        </div>
        <button
          type="button"
          onClick={onOpenDirPicker}
          className="text-muted-foreground hover:bg-muted/40 hover:text-foreground flex cursor-pointer items-center gap-1 rounded-xs p-1 transition-colors"
          title="Open Folder (Cmd+N)"
        >
          <FolderPlus className="size-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {projects.length === 0 ? (
          <div className="text-muted-foreground p-3 text-xs italic">No projects opened.</div>
        ) : (
          projects.map((proj, index) => {
            const isActive = proj.id === activeProjectId;
            const pState = projectStates?.[proj.id];

            return (
              <div
                key={proj.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectProject(proj.id)}
                onKeyDown={activateOnKey(() => onSelectProject(proj.id))}
                className={`group border-border/40 flex w-full cursor-pointer flex-col items-start gap-1 border-b px-3 py-2.5 text-left transition-colors ${
                  isActive
                    ? "bg-muted/70 text-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                }`}
              >
                <div className="relative flex w-full items-center gap-2 text-xs">
                  <Folder
                    className={`size-4 shrink-0 ${
                      isActive ? "text-primary" : "text-muted-foreground/70"
                    }`}
                  />
                  {editingId === proj.id ? (
                    <div className="flex flex-1 items-center gap-1">
                      <input
                        ref={inputRef}
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveEdit(e);
                          else if (e.key === "Escape") handleCancelEdit(e);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-background border-border text-foreground focus:ring-primary w-full rounded-sm border px-1 py-0.5 text-xs focus:ring-1 focus:outline-none"
                      />
                      <button
                        type="button"
                        aria-label="Save name"
                        onClick={handleSaveEdit}
                        className="p-0.5 text-green-500 hover:text-green-400"
                      >
                        <Check className="size-3" />
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel rename"
                        onClick={handleCancelEdit}
                        className="p-0.5 text-red-500 hover:text-red-400"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="flex-1 font-semibold break-words">{proj.name}</span>
                      {isCommandHeld && index < 9 && (
                        <span className="border-border bg-background text-muted-foreground text-2xs pointer-events-none absolute top-1/2 right-0 z-10 -translate-y-1/2 rounded-sm border px-1 font-mono shadow-sm">
                          ⌘{index + 1}
                        </span>
                      )}
                      {pState?.hasUnread && (
                        <div
                          className="size-2 shrink-0 rounded-full bg-blue-500"
                          title="Unread updates"
                        />
                      )}

                      <button
                        type="button"
                        aria-label="Project actions"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId(menuOpenId === proj.id ? null : proj.id);
                        }}
                        className="text-muted-foreground hover:bg-muted rounded-sm p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <MoreVertical className="size-3.5" />
                      </button>

                      {menuOpenId === proj.id && (
                        <div className="bg-popover border-border text-popover-foreground absolute top-6 right-0 z-10 flex w-32 flex-col rounded-md border py-1 shadow-md">
                          <button
                            type="button"
                            onClick={(e) => handleStartEdit(e, proj)}
                            className="hover:bg-muted flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
                          >
                            <Pencil className="size-3" /> Rename
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDelete(e, proj.id)}
                            className="hover:bg-muted flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-500"
                          >
                            <Trash2 className="size-3" /> Remove
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="text-2xs mt-1 flex w-full flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 opacity-80">
                    <span className="text-muted-foreground w-14">Agent:</span>
                    <span>
                      {pState?.agentState === "running"
                        ? "🔄 Working"
                        : pState?.agentState === "awaiting"
                          ? "💬 Awaiting User"
                          : "💤 Idle"}
                    </span>
                  </div>
                </div>

                <div className="text-2xs mt-1.5 w-full font-mono leading-tight break-all opacity-40">
                  {tildify(proj.path)}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="border-border/80 text-muted-foreground/60 text-2xs border-t p-2 text-center font-mono">
        ⌘N: Add Project • ⌘T: New Tab
      </div>
    </aside>
  );
}
