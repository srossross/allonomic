import { readTextFile, writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
import { resolve, dirname } from "@tauri-apps/api/path";
import YAML from "yaml";
import type { WorkspaceState } from "../types/persistence";

async function getWorkspaceStatePath(workspaceDir: string): Promise<string> {
  return await resolve(workspaceDir, ".allonomic", "workspace.yml");
}

export async function loadWorkspaceState(workspaceDir: string): Promise<WorkspaceState | null> {
  const filePath = await getWorkspaceStatePath(workspaceDir);
  try {
    const raw = await readTextFile(filePath);
    const data: unknown = YAML.parse(raw);
    if (!data || typeof data !== "object") return null;

    const activeTabIdRaw = Reflect.get(data, "active_tab_id") || Reflect.get(data, "activeTabId");
    const activeTabId = typeof activeTabIdRaw === "string" ? activeTabIdRaw : "";

    const openTabIdsRaw = Reflect.get(data, "open_tab_ids") || Reflect.get(data, "openTabIds");
    const openTabIds = Array.isArray(openTabIdsRaw)
      ? openTabIdsRaw.filter((id): id is string => typeof id === "string")
      : [];

    const inspectorTabsRaw = Reflect.get(data, "inspector_tabs");
    const inspectorTabs = Array.isArray(inspectorTabsRaw)
      ? inspectorTabsRaw.filter((id): id is string => typeof id === "string")
      : undefined;

    return {
      activeTabId,
      openTabIds,
      inspectorTabs,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (
      !errorMsg.includes("No such file") &&
      !errorMsg.includes("os error 2") &&
      !errorMsg.includes("system cannot find the path")
    ) {
      console.error("[WorkspaceState] Error loading workspace state:", error);
      globalThis.alert("Failed to parse workspace state: " + errorMsg);
    }
    return null;
  }
}

async function patchWorkspaceFile(
  workspaceDir: string,
  patch: Record<string, unknown>
): Promise<void> {
  const filePath = await getWorkspaceStatePath(workspaceDir);
  await mkdir(await dirname(filePath), { recursive: true });

  let raw = "";
  try {
    raw = await readTextFile(filePath);
  } catch {
    // first save: no file yet
  }
  const existing: unknown = YAML.parse(raw);
  const yml = YAML.stringify({
    ...(typeof existing === "object" && existing),
    ...patch,
    updated_at: new Date().toISOString(),
  });

  await writeTextFile(filePath, yml);
}

export async function saveWorkspaceState(
  workspaceDir: string,
  state: WorkspaceState
): Promise<void> {
  await patchWorkspaceFile(workspaceDir, {
    active_tab_id: state.activeTabId,
    open_tab_ids: state.openTabIds,
  });
}

export async function saveInspectorTabs(workspaceDir: string, tabs: string[]): Promise<void> {
  await patchWorkspaceFile(workspaceDir, { inspector_tabs: tabs });
}
