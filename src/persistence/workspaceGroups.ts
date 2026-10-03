import { isGroupColor } from "../types/groupColors";
import type { WorkspaceGroup, WorkspacesConfig } from "../types/persistence";

export function parseGroups(raw: unknown): WorkspaceGroup[] {
  if (!Array.isArray(raw)) return [];
  const groups: WorkspaceGroup[] = [];
  for (const entry of raw) {
    if (!(entry && typeof entry === "object")) continue;
    const id = Reflect.get(entry, "id");
    const name = Reflect.get(entry, "name");
    const color = Reflect.get(entry, "color");
    if (typeof id !== "string" || typeof name !== "string" || !isGroupColor(color)) continue;
    groups.push({
      id,
      name,
      color,
      ...(Reflect.get(entry, "collapsed") === true && { collapsed: true }),
    });
  }
  return groups;
}

export function serializeGroups(groups: WorkspaceGroup[]): Record<string, unknown>[] {
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    color: g.color,
    ...(g.collapsed && { collapsed: true }),
  }));
}

export function readGroupId(entry: object, groups: WorkspaceGroup[]): string | undefined {
  const value = Reflect.get(entry, "group");
  return typeof value === "string" && groups.some((g) => g.id === value) ? value : undefined;
}

export function removeGroup(config: WorkspacesConfig, groupId: string): void {
  config.groups = config.groups.filter((g) => g.id !== groupId);
  for (const w of config.workspaces) {
    if (w.groupId === groupId) w.groupId = undefined;
  }
}
