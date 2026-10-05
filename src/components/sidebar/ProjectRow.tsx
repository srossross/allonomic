import { Folder, MoreVertical, Pencil, Trash2, Check } from "lucide-react";
import { GROUP_COLORS, type Project, type WorkspaceGroup } from "@/types";
import { activateOnKey } from "@/lib/activateOnKey";
import { tildify } from "@/lib/tildify";
import { InlineNameEditor } from "./InlineNameEditor";

export const PROJECT_DRAG_TYPE = "application/x-atomic-project";

export interface ProjectState {
  agentState: "idle" | "running" | "awaiting";
  hasUnread: boolean;
}

interface ProjectRowProperties {
  project: Project;
  isActive: boolean;
  projectState?: ProjectState;
  shortcutIndex: number;
  showShortcut: boolean;
  groups: WorkspaceGroup[];
  isMenuOpen: boolean;
  isEditing: boolean;
  onToggleMenu: () => void;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onSelect: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onMoveToGroup: (groupId: string | undefined) => void;
}

const menuItemClass = "hover:bg-muted flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs";

export function ProjectRow({
  project,
  isActive,
  projectState,
  shortcutIndex,
  showShortcut,
  groups,
  isMenuOpen,
  isEditing,
  onToggleMenu,
  onStartEdit,
  onEndEdit,
  onSelect,
  onRename,
  onDelete,
  onMoveToGroup,
}: ProjectRowProperties) {
  const group = groups.find((g) => g.id === project.groupId);
  const folderColor = group
    ? GROUP_COLORS[group.color].text
    : isActive
      ? "text-primary"
      : "text-muted-foreground/70";

  const moveTo = (e: React.MouseEvent, groupId: string | undefined) => {
    e.stopPropagation();
    onMoveToGroup(groupId);
    onToggleMenu();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!isEditing}
      onDragStart={(e) => {
        e.dataTransfer.setData(PROJECT_DRAG_TYPE, project.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onSelect}
      onKeyDown={activateOnKey(onSelect)}
      className={`group border-border/40 flex w-full cursor-pointer flex-col items-start gap-1 border-b px-3 py-2.5 text-left transition-colors ${
        isActive
          ? "bg-primary/10 ring-primary/40 text-foreground font-medium ring-1 ring-inset"
          : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
      }`}
    >
      <div className="relative flex w-full items-center gap-2 text-xs">
        <Folder className={`size-4 shrink-0 ${folderColor}`} />
        {isEditing ? (
          <InlineNameEditor
            initialName={project.name}
            onSave={(name) => {
              onRename(name);
              onEndEdit();
            }}
            onCancel={onEndEdit}
          />
        ) : (
          <>
            <span className="flex-1 font-semibold break-words">{project.name}</span>
            {showShortcut && shortcutIndex < 9 && (
              <span className="border-border bg-background text-muted-foreground text-2xs pointer-events-none absolute top-1/2 right-0 z-10 -translate-y-1/2 rounded-sm border px-1 font-mono shadow-sm">
                ⌘{shortcutIndex + 1}
              </span>
            )}
            {projectState?.hasUnread && (
              <div className="size-2 shrink-0 rounded-full bg-blue-500" title="Unread updates" />
            )}

            <button
              type="button"
              aria-label="Project actions"
              onClick={(e) => {
                e.stopPropagation();
                onToggleMenu();
              }}
              className="text-muted-foreground hover:bg-muted rounded-sm p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <MoreVertical className="size-3.5" />
            </button>

            {isMenuOpen && (
              <div className="bg-popover border-border text-popover-foreground absolute top-6 right-0 z-10 flex w-40 flex-col rounded-md border py-1 shadow-md">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartEdit();
                  }}
                  className={menuItemClass}
                >
                  <Pencil className="size-3" /> Rename
                </button>
                {groups.length > 0 && (
                  <>
                    <div className="border-border/60 text-muted-foreground text-2xs mt-1 border-t px-3 pt-1.5 pb-0.5">
                      Move to group
                    </div>
                    {groups.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={(e) => moveTo(e, g.id)}
                        className={menuItemClass}
                      >
                        <span
                          className={`size-2 shrink-0 rounded-full ${GROUP_COLORS[g.color].dot}`}
                        />
                        <span className="flex-1 truncate">{g.name}</span>
                        {g.id === project.groupId && <Check className="size-3" />}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={(e) => moveTo(e, undefined)}
                      className={`${menuItemClass} border-border/60 mb-1 border-b`}
                    >
                      <span className="size-2 shrink-0" />
                      <span className="flex-1">No group</span>
                      {!project.groupId && <Check className="size-3" />}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                    onToggleMenu();
                  }}
                  className={`${menuItemClass} text-red-500`}
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
            {projectState?.agentState === "running"
              ? "🔄 Working"
              : projectState?.agentState === "awaiting"
                ? "💬 Awaiting User"
                : "💤 Idle"}
          </span>
        </div>
      </div>

      <div className="text-2xs mt-1.5 w-full font-mono leading-tight break-all opacity-40">
        {tildify(project.path)}
      </div>
    </div>
  );
}
