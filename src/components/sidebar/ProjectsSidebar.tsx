import { open } from "@tauri-apps/plugin-dialog";

import { useRef, useState, useEffect } from "react";
import { Folder, FolderPlus, MoreVertical, Pencil, Trash2, Check, X } from "lucide-react";
import type { Project } from "@/types";

interface ProjectState {
  agentState: "idle" | "running" | "awaiting";
  hasUnread: boolean;
}

interface ProjectsSidebarProperties {
  projects: Project[];
  activeProjectId: string;
  onSelectProject: (projectId: string) => void;
  onAddProject: (name: string, path: string) => void;
  onRenameProject: (projectId: string, newName: string) => void;
  onDeleteProject: (projectId: string) => void;
  onStartContainer: (path: string) => void;
  projectStates?: Record<string, ProjectState>;
}

export function ProjectsSidebar({
  projects,
  activeProjectId,
  onSelectProject,
  onAddProject,
  onRenameProject,
  onDeleteProject,
  onStartContainer,
  projectStates,
}: ProjectsSidebarProperties) {
  const dirInputRef = useRef<HTMLInputElement>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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

  const handleOpenDirPicker = async () => {
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
      });
      if (typeof selectedPath === "string") {
        const name = selectedPath.split(/[/\\]/).pop() || selectedPath;
        onAddProject(name, selectedPath);
      }
      return;
    } catch (error) {
      console.warn("Tauri dialog failed, falling back", error);
    }

    if (globalThis.showDirectoryPicker) {
      try {
        const handle = await globalThis.showDirectoryPicker();
        if (handle?.name) {
          onAddProject(handle.name, handle.name);
          return;
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }

    dirInputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const firstFile = files[0];
      const relativePath = firstFile.webkitRelativePath || "";
      const dirName = relativePath.split("/", 1)[0] || firstFile.name || "New Project";
      onAddProject(dirName, dirName);
    }
    e.target.value = "";
  };

  return (
    <aside className="border-border/80 bg-muted/20 flex h-full w-56 flex-col border-r text-xs select-none">
      {/* Sidebar Header */}
      <div className="border-border/80 flex h-9 items-center justify-between border-b px-3">
        <div className="flex items-center gap-1.5">
          <span className="text-foreground text-xs font-semibold tracking-tight">
            {projects.find((p) => p.id === activeProjectId)?.name || "atomic"}
          </span>
          <span className="text-muted-foreground/60 font-mono text-[10px]">/ projects</span>
        </div>
        <button
          type="button"
          onClick={handleOpenDirPicker}
          className="text-muted-foreground hover:bg-muted/40 hover:text-foreground flex cursor-pointer items-center gap-1 rounded-xs p-1 transition-colors"
          title="Open Folder (Cmd+N)"
        >
          <FolderPlus className="size-3.5" />
        </button>
      </div>

      {/* Hidden File Input for Folder Selection Fallback */}
      <input
        ref={dirInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is non-standard but supported
        webkitdirectory="true"
        directory=""
        multiple
        className="hidden"
        onChange={handleInputChange}
      />

      {/* Project Flat List */}
      <div className="flex-1 overflow-y-auto">
        {projects.length === 0 ? (
          <div className="text-muted-foreground p-3 text-[11px] italic">No projects opened.</div>
        ) : (
          projects.map((proj) => {
            const isActive = proj.id === activeProjectId;
            const pState = projectStates?.[proj.id];

            return (
              <div
                key={proj.id}
                onClick={() => onSelectProject(proj.id)}
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
                        onClick={handleSaveEdit}
                        className="p-0.5 text-green-500 hover:text-green-400"
                      >
                        <Check className="size-3" />
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="p-0.5 text-red-500 hover:text-red-400"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="flex-1 font-semibold break-words">{proj.name}</span>
                      {pState?.hasUnread && (
                        <div
                          className="size-2 shrink-0 rounded-full bg-blue-500"
                          title="Unread updates"
                        />
                      )}

                      <button
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
                            onClick={(e) => handleStartEdit(e, proj)}
                            className="hover:bg-muted flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
                          >
                            <Pencil className="size-3" /> Rename
                          </button>
                          <button
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

                <div className="mt-1 flex w-full flex-col gap-0.5 text-[10px]">
                  {proj.devcontainerStatus && (
                    <div className="flex items-center gap-1.5 opacity-80">
                      <span className="text-muted-foreground w-14">Container:</span>
                      <span>
                        {proj.devcontainerStatus === "running" && "🟢 Running"}
                        {proj.devcontainerStatus === "stopped" && "🔴 Stopped"}
                        {proj.devcontainerStatus === "not_setup" && "⚪ Not Set Up"}
                      </span>
                      {proj.devcontainerStatus !== "running" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onStartContainer(proj.path);
                          }}
                          className="border-border hover:bg-muted rounded border px-1"
                        >
                          Start
                        </button>
                      )}
                    </div>
                  )}
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

                <div className="mt-1.5 w-full font-mono text-[9px] leading-tight break-all opacity-40">
                  {proj.path.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~")}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Keyboard Shortcut Hint Footer */}
      <div className="border-border/80 text-muted-foreground/60 border-t p-2 text-center font-mono text-[10px]">
        ⌘N: Add Project • ⌘T: New Tab
      </div>
    </aside>
  );
}

export { type Project } from "@/types";
