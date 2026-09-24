import { useRef } from "react";
import { Folder, FolderPlus } from "lucide-react";
import type { Project } from "@/types";

interface ProjectsSidebarProperties {
  projects: Project[];
  activeProjectId: string;
  onSelectProject: (projectId: string) => void;
  onAddProject: (name: string, path: string) => void;
}

export function ProjectsSidebar({
  projects,
  activeProjectId,
  onSelectProject,
  onAddProject,
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
        <span className="text-muted-foreground font-mono text-[10px] font-semibold tracking-wider uppercase">
          Projects
        </span>
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
      <div className="flex-1 space-y-0.5 overflow-y-auto p-1.5">
        {projects.length === 0 ? (
          <div className="text-muted-foreground p-3 text-[11px] italic">No projects opened.</div>
        ) : (
          projects.map((proj) => {
            const isActive = proj.id === activeProjectId;
            return (
              <button
                key={proj.id}
                type="button"
                onClick={() => onSelectProject(proj.id)}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-xs px-2 py-1.5 text-left text-xs transition-colors ${
                  isActive
                    ? "bg-muted/70 text-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                }`}
              >
                <Folder
                  className={`size-3.5 shrink-0 ${
                    isActive ? "text-primary" : "text-muted-foreground/70"
                  }`}
                />
                <span className="flex-1 truncate">{proj.name}</span>
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
