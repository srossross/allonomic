import { useState, useEffect } from "react";
import { FolderPlus, ListPlus } from "lucide-react";
import {
  GROUP_COLORS,
  GROUP_COLOR_KEYS,
  type GroupColor,
  type Project,
  type WorkspaceGroup,
} from "@/types";
import { GroupHeader } from "./GroupHeader";
import { PROJECT_DRAG_TYPE, ProjectRow, type ProjectState } from "./ProjectRow";

interface ProjectsSidebarProperties {
  projects: Project[];
  groups: WorkspaceGroup[];
  activeProjectId: string;
  onSelectProject: (projectId: string) => void;
  onOpenDirPicker: () => void;
  onRenameProject: (projectId: string, newName: string) => void;
  onDeleteProject: (projectId: string) => void;
  onCreateGroup: (name: string, color: GroupColor) => Promise<string | undefined>;
  onUpdateGroup: (groupId: string, patch: Partial<Omit<WorkspaceGroup, "id">>) => void;
  onDeleteGroup: (groupId: string) => void;
  onSetProjectGroup: (projectId: string, groupId: string | undefined) => void;
  projectStates?: Record<string, ProjectState>;
}

const UNGROUPED_KEY = "ungrouped";

export function ProjectsSidebar({
  projects,
  groups,
  activeProjectId,
  onSelectProject,
  onOpenDirPicker,
  onRenameProject,
  onDeleteProject,
  onCreateGroup,
  onUpdateGroup,
  onDeleteGroup,
  onSetProjectGroup,
  projectStates,
}: ProjectsSidebarProperties) {
  const [menuOpenKey, setMenuOpenKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
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

  const toggleMenu = (key: string) => setMenuOpenKey((open) => (open === key ? null : key));

  const startEdit = (key: string) => {
    setEditingKey(key);
    setMenuOpenKey(null);
  };

  const handleNewGroup = async () => {
    const color = GROUP_COLOR_KEYS[groups.length % GROUP_COLOR_KEYS.length];
    const id = await onCreateGroup("New group", color);
    if (id) startEdit(`g:${id}`);
  };

  const dropTargetProps = (key: string, groupId: string | undefined) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(PROJECT_DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragOverKey !== key) setDragOverKey(key);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) {
        setDragOverKey(null);
      }
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverKey(null);
      const projectId = e.dataTransfer.getData(PROJECT_DRAG_TYPE);
      const project = projects.find((p) => p.id === projectId);
      if (project && project.groupId !== groupId) onSetProjectGroup(projectId, groupId);
    },
  });

  const renderProject = (proj: Project) => (
    <ProjectRow
      key={proj.id}
      project={proj}
      isActive={proj.id === activeProjectId}
      projectState={projectStates?.[proj.id]}
      shortcutIndex={projects.indexOf(proj)}
      showShortcut={isCommandHeld}
      groups={groups}
      isMenuOpen={menuOpenKey === `p:${proj.id}`}
      isEditing={editingKey === `p:${proj.id}`}
      onToggleMenu={() => toggleMenu(`p:${proj.id}`)}
      onStartEdit={() => startEdit(`p:${proj.id}`)}
      onEndEdit={() => setEditingKey(null)}
      onSelect={() => onSelectProject(proj.id)}
      onRename={(name) => onRenameProject(proj.id, name)}
      onDelete={() => onDeleteProject(proj.id)}
      onMoveToGroup={(groupId) => onSetProjectGroup(proj.id, groupId)}
    />
  );

  const ungrouped = projects.filter((p) => groups.every((g) => g.id !== p.groupId));

  return (
    <aside
      className="border-border/80 bg-muted/20 flex h-full w-56 flex-col border-r text-xs select-none"
      onDragEnd={() => setDragOverKey(null)}
    >
      <div className="border-border/80 flex h-9 items-center justify-between border-b px-3">
        <div className="flex items-center gap-1.5">
          <span className="text-foreground text-xs font-semibold tracking-tight">
            {projects.find((p) => p.id === activeProjectId)?.name || "atomic"}
          </span>
          <span className="text-muted-foreground/60 text-2xs font-mono">/ projects</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void handleNewGroup()}
            className="text-muted-foreground hover:bg-muted/40 hover:text-foreground flex cursor-pointer items-center gap-1 rounded-xs p-1 transition-colors"
            title="New Group"
          >
            <ListPlus className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onOpenDirPicker}
            className="text-muted-foreground hover:bg-muted/40 hover:text-foreground flex cursor-pointer items-center gap-1 rounded-xs p-1 transition-colors"
            title="Open Folder (Cmd+N)"
          >
            <FolderPlus className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {projects.length === 0 && groups.length === 0 ? (
          <div className="text-muted-foreground p-3 text-xs italic">No projects opened.</div>
        ) : (
          <>
            {groups.map((group) => {
              const members = projects.filter((p) => p.groupId === group.id);
              const key = `g:${group.id}`;
              return (
                <div
                  key={group.id}
                  {...dropTargetProps(key, group.id)}
                  className={`relative ${
                    dragOverKey === key ? `ring-1 ring-inset ${GROUP_COLORS[group.color].ring}` : ""
                  }`}
                >
                  <span
                    className={`pointer-events-none absolute inset-y-0 left-0 z-10 w-0.5 ${GROUP_COLORS[group.color].dot}`}
                  />
                  <GroupHeader
                    group={group}
                    memberCount={members.length}
                    isMenuOpen={menuOpenKey === key}
                    isEditing={editingKey === key}
                    onToggleMenu={() => toggleMenu(key)}
                    onStartEdit={() => startEdit(key)}
                    onEndEdit={() => setEditingKey(null)}
                    onToggleCollapsed={() =>
                      onUpdateGroup(group.id, { collapsed: !group.collapsed })
                    }
                    onRename={(name) => onUpdateGroup(group.id, { name })}
                    onSetColor={(color) => onUpdateGroup(group.id, { color })}
                    onDelete={() => onDeleteGroup(group.id)}
                  />
                  {!group.collapsed &&
                    (members.length > 0 ? (
                      members.map((p) => renderProject(p))
                    ) : (
                      <div className="text-muted-foreground/60 border-border/40 text-2xs border-b px-3 py-2 italic">
                        Drag projects here
                      </div>
                    ))}
                </div>
              );
            })}

            {groups.length > 0 ? (
              <div
                {...dropTargetProps(UNGROUPED_KEY, undefined)}
                className={`min-h-16 ${dragOverKey === UNGROUPED_KEY ? "ring-primary ring-1 ring-inset" : ""}`}
              >
                <div className="border-border/60 text-muted-foreground text-2xs flex h-6 items-center border-b px-3 font-semibold tracking-tight">
                  Ungrouped
                </div>
                {ungrouped.map((p) => renderProject(p))}
              </div>
            ) : (
              ungrouped.map((p) => renderProject(p))
            )}
          </>
        )}
      </div>

      <div className="border-border/80 text-muted-foreground/60 text-2xs border-t p-2 text-center font-mono">
        ⌘N: Add Project • ⌘T: New Tab
      </div>
    </aside>
  );
}
