import { ChevronDown, ChevronRight, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { GROUP_COLORS, type GroupColor, type WorkspaceGroup } from "@/types";
import { activateOnKey } from "@/lib/activateOnKey";
import { ColorSwatches } from "./ColorSwatches";
import { InlineNameEditor } from "./InlineNameEditor";

interface GroupHeaderProperties {
  group: WorkspaceGroup;
  memberCount: number;
  isMenuOpen: boolean;
  isEditing: boolean;
  onToggleMenu: () => void;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onToggleCollapsed: () => void;
  onRename: (name: string) => void;
  onSetColor: (color: GroupColor) => void;
  onDelete: () => void;
}

const menuItemClass = "hover:bg-muted flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs";

export function GroupHeader({
  group,
  memberCount,
  isMenuOpen,
  isEditing,
  onToggleMenu,
  onStartEdit,
  onEndEdit,
  onToggleCollapsed,
  onRename,
  onSetColor,
  onDelete,
}: GroupHeaderProperties) {
  const Chevron = group.collapsed ? ChevronRight : ChevronDown;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggleCollapsed}
      onKeyDown={activateOnKey(onToggleCollapsed)}
      className="group/header border-border/60 bg-muted/30 hover:bg-muted/50 text-foreground relative flex h-7 w-full cursor-pointer items-center gap-1.5 border-b pr-2 pl-1.5 text-xs"
    >
      <Chevron className="text-muted-foreground size-3.5 shrink-0" />
      <span className={`size-2 shrink-0 rounded-full ${GROUP_COLORS[group.color].dot}`} />
      {isEditing ? (
        <InlineNameEditor
          initialName={group.name}
          onSave={(name) => {
            onRename(name);
            onEndEdit();
          }}
          onCancel={onEndEdit}
        />
      ) : (
        <>
          <span className="flex-1 truncate font-semibold tracking-tight">{group.name}</span>
          <span className="text-muted-foreground/70 text-2xs font-mono">{memberCount}</span>
          <button
            type="button"
            aria-label="Group actions"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMenu();
            }}
            className="text-muted-foreground hover:bg-muted rounded-sm p-0.5 opacity-0 transition-opacity group-hover/header:opacity-100"
          >
            <MoreVertical className="size-3.5" />
          </button>

          {isMenuOpen && (
            <div
              className="bg-popover border-border text-popover-foreground absolute top-6 right-1 z-20 flex w-36 cursor-default flex-col rounded-md border py-1 shadow-md"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              role="menu"
              tabIndex={-1}
            >
              <button type="button" onClick={onStartEdit} className={menuItemClass}>
                <Pencil className="size-3" /> Rename
              </button>
              <div className="text-muted-foreground text-2xs px-3 pt-1">Color</div>
              <ColorSwatches value={group.color} onChange={onSetColor} />
              <button
                type="button"
                onClick={() => {
                  onDelete();
                  onToggleMenu();
                }}
                className={`${menuItemClass} border-border/60 mt-1 border-t text-red-500`}
              >
                <Trash2 className="size-3" /> Delete group
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
