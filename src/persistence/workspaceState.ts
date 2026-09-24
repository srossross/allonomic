import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { WorkspaceState } from "../types/persistence";

export function getWorkspaceStatePath(workspaceDir: string): string {
  return path.join(workspaceDir, ".atomic", "workspace.yml");
}

export async function loadWorkspaceState(workspaceDir: string): Promise<WorkspaceState | null> {
  const filePath = getWorkspaceStatePath(workspaceDir);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data: unknown = YAML.parse(raw);
    if (!data || typeof data !== "object") return null;

    const activeTabIdRaw = Reflect.get(data, "active_tab_id") || Reflect.get(data, "activeTabId");
    const activeTabId = typeof activeTabIdRaw === "string" ? activeTabIdRaw : "";

    const openTabIdsRaw = Reflect.get(data, "open_tab_ids") || Reflect.get(data, "openTabIds");
    const openTabIds = Array.isArray(openTabIdsRaw)
      ? openTabIdsRaw.filter((id): id is string => typeof id === "string")
      : [];

    return {
      activeTabId,
      openTabIds,
    };
  } catch {
    return null;
  }
}

export async function saveWorkspaceState(
  workspaceDir: string,
  state: WorkspaceState
): Promise<void> {
  const filePath = getWorkspaceStatePath(workspaceDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const yml = YAML.stringify({
    active_tab_id: state.activeTabId,
    open_tab_ids: state.openTabIds,
    updated_at: new Date().toISOString(),
  });

  await fs.writeFile(filePath, yml, "utf8");
}
