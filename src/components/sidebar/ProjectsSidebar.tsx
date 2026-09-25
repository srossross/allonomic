import { useRef } from "react";
import { Folder, FolderPlus } from "lucide-react";
import type { Project } from "@/types";

interface ProjectState {
  agentState: 'idle' | 'running' | 'awaiting';
  hasUnread: boolean;
}

interface ProjectsSidebarProperties {
  projects: Project[];
  activeProjectId: string;
  onSelectProject: (projectId: string) => void;
  onAddProject: (name: string, path: string) => void;
  projectStates?: Record<string, ProjectState>;
}

export function ProjectsSidebar({
  projects,
  activeProjectId,
  onSelectProject,
  onAddProject,
  projectStates,
}: ProjectsSidebarProperties) {
  const dirInputRef = useRef<HTMLInputElement>(null);

  const handleOpenDirPicker = async () => {
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
          <span className="text-foreground font-semibold text-xs tracking-tight">{activeProject?.name || "atomic"}</span>
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
              <button
                key={proj.id}
                type="button"
                onClick={() => onSelectProject(proj.id)}
                className={`group flex w-full cursor-pointer flex-col items-start gap-1 border-b border-border/40 px-3 py-2.5 text-left transition-colors ${
                  isActive
                    ? "bg-muted/70 text-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                }`}
              >
                <div className="flex w-full items-center gap-2 text-xs">
                  <Folder
                    className={`size-4 shrink-0 ${
                      isActive ? "text-primary" : "text-muted-foreground/70"
                    }`}
                  />
                  <span className="flex-1 break-words font-semibold">{proj.name}</span>
                  {pState?.hasUnread && (
                    <div className="size-2 shrink-0 rounded-full bg-blue-500" title="Unread updates" />
                  )}
                </div>

                <div className="mt-1 flex w-full flex-col gap-0.5 text-[10px]">
                  {proj.devcontainerStatus && (
                     <div className="flex items-center gap-1.5 opacity-80">
                        <span className="text-muted-foreground w-14">Container:</span>
                        <span>
                          {proj.devcontainerStatus === 'running' && '🟢 Running'}
                          {proj.devcontainerStatus === 'stopped' && '🔴 Stopped'}
                          {proj.devcontainerStatus === 'not_setup' && '⚪ Not Set Up'}
                        </span>
                     </div>
                  )}
                  <div className="flex items-center gap-1.5 opacity-80">
                     <span className="text-muted-foreground w-14">Agent:</span>
                     <span>{pState?.agentState === 'running' ? '🔄 Working' : (pState?.agentState === 'awaiting' ? '💬 Awaiting User' : '💤 Idle')}</span>
                  </div>
                </div>

                <div className="mt-1.5 w-full break-all font-mono text-[9px] leading-tight opacity-40">
                  {proj.path.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~')}
                </div>
              </button>
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
