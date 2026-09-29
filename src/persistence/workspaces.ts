import { readTextFile, writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
import { join, resolve, dirname } from "@tauri-apps/api/path";
import YAML from "yaml";
import { getAppConfigDir } from "./configPaths";
import type { WorkspacesConfig, WorkspaceItem } from "../types/persistence";

async function getWorkspacesFilePath(): Promise<string> {
  const configDir = await getAppConfigDir();
  return await join(configDir, "workspaces.yml");
}

function readLastOpened(entry: object): string | undefined {
  const value = Reflect.get(entry, "last_opened") || Reflect.get(entry, "lastOpened");
  return typeof value === "string" ? value : undefined;
}

export async function loadWorkspacesConfig(): Promise<WorkspacesConfig> {
  const filePath = await getWorkspacesFilePath();
  try {
    const raw = await readTextFile(filePath);
    const data: unknown = YAML.parse(raw);
    if (data && typeof data === "object") {
      const activeRaw =
        Reflect.get(data, "active_workspace_id") || Reflect.get(data, "activeWorkspaceId");
      const activeWorkspaceId = typeof activeRaw === "string" ? activeRaw : undefined;

      const workspacesRaw = Reflect.get(data, "workspaces");
      const validWorkspaces: WorkspaceItem[] = [];

      if (workspacesRaw && typeof workspacesRaw === "object") {
        if (Array.isArray(workspacesRaw)) {
          // Legacy array format
          for (const w of workspacesRaw) {
            if (!(w && typeof w === "object")) {
              continue;
            }

            const name = Reflect.get(w, "name");
            const workspacePath = Reflect.get(w, "path");
            if (typeof name !== "string" || typeof workspacePath !== "string") continue;

            const resolvedPath = await resolve(workspacePath);
            validWorkspaces.push({
              id: resolvedPath, // Upgrade id to path
              name,
              path: resolvedPath,
              lastOpened: readLastOpened(w),
              archived: Reflect.get(w, "archived") === true,
            });
          }
        } else {
          // New map format
          for (const [pathKey, val] of Object.entries(workspacesRaw)) {
            if (!(val && typeof val === "object")) {
              continue;
            }

            const resolvedPath = await resolve(pathKey);
            const name = Reflect.get(val, "name");
            validWorkspaces.push({
              id: resolvedPath,
              path: resolvedPath,
              name:
                typeof name === "string" ? name : resolvedPath.split(/[/\\]/).pop() || resolvedPath,
              lastOpened: readLastOpened(val),
              archived: Reflect.get(val, "archived") === true,
            });
          }
        }

        if (validWorkspaces.length > 0) {
          // If activeWorkspaceId is a legacy 'proj-xxx' id, map it to the path if found
          let resolvedActiveId = activeWorkspaceId;
          if (activeWorkspaceId && activeWorkspaceId.startsWith("proj-")) {
            // We can't map it easily since legacy format didn't have path in active_workspace_id.
            // But if we upgraded it, we might just default to the first one.
            const legacyItem = validWorkspaces.find(
              (w) => w.id === activeWorkspaceId || w.path === activeWorkspaceId
            );
            resolvedActiveId = legacyItem ? legacyItem.path : validWorkspaces[0].path;
          }

          return {
            activeWorkspaceId: resolvedActiveId || validWorkspaces[0].path,
            workspaces: validWorkspaces,
          };
        }
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    // Ignore "file not found" errors on first run
    if (
      !errorMsg.includes("No such file") &&
      !errorMsg.includes("os error 2") &&
      !errorMsg.includes("system cannot find the path")
    ) {
      console.error("[WorkspacesConfig] Error reading workspaces config:", error);
      const shouldOverwrite = globalThis.confirm(
        `Failed to parse workspaces configuration.\nError: ${errorMsg}\n\nDo you want to overwrite it with a blank/default state?`
      );
      if (!shouldOverwrite) {
        throw error;
      }
    }
  }
  const initialConfig: WorkspacesConfig = {
    activeWorkspaceId: undefined,
    workspaces: [],
  };

  try {
    await saveWorkspacesConfig(initialConfig);
  } catch (error) {
    console.warn(`[WorkspacesConfig] Unable to save initial workspaces config:`, error);
  }

  return initialConfig;
}

async function saveWorkspacesConfig(config: WorkspacesConfig): Promise<void> {
  const filePath = await getWorkspacesFilePath();
  const dir = await dirname(filePath);
  await mkdir(dir, { recursive: true });

  const workspacesMap: Record<string, unknown> = {};
  for (const w of config.workspaces) {
    workspacesMap[w.path] = {
      name: w.name,
      ...(w.lastOpened && { last_opened: w.lastOpened }),
      ...(w.archived && { archived: true }),
    };
  }

  const yml = YAML.stringify({
    active_workspace_id: config.activeWorkspaceId,
    workspaces: workspacesMap,
  });
  await writeTextFile(filePath, yml);
}

export async function addOrUpdateWorkspace(workspace: WorkspaceItem): Promise<WorkspacesConfig> {
  const config = await loadWorkspacesConfig();

  // Always store absolute paths
  workspace.path = await resolve(workspace.path);
  workspace.id = workspace.path; // force ID to be the path

  const index = config.workspaces.findIndex((w) => w.path === workspace.path);

  const updatedItem: WorkspaceItem = {
    ...workspace,
    lastOpened: new Date().toISOString(),
  };

  if (index === -1) {
    config.workspaces.push(updatedItem);
  } else {
    config.workspaces[index] = updatedItem;
  }

  config.activeWorkspaceId = updatedItem.path;
  await saveWorkspacesConfig(config);
  return config;
}

export async function setActiveWorkspaceId(workspaceId: string): Promise<WorkspacesConfig> {
  const config = await loadWorkspacesConfig();
  // Ensure workspaceId is a path, since UI might send an old id or path
  const found = config.workspaces.find((w) => w.id === workspaceId || w.path === workspaceId);
  if (found) {
    found.lastOpened = new Date().toISOString();
    config.activeWorkspaceId = found.path;
  } else {
    config.activeWorkspaceId = workspaceId;
  }
  await saveWorkspacesConfig(config);
  return config;
}

export async function renameWorkspace(
  workspaceId: string,
  newName: string
): Promise<WorkspacesConfig> {
  const config = await loadWorkspacesConfig();
  const found = config.workspaces.find((w) => w.id === workspaceId || w.path === workspaceId);
  if (found) {
    found.name = newName;
    await saveWorkspacesConfig(config);
  }
  return config;
}

export async function deleteWorkspace(workspaceId: string): Promise<WorkspacesConfig> {
  const config = await loadWorkspacesConfig();
  const workspace = config.workspaces.find((w) => w.id === workspaceId || w.path === workspaceId);
  if (workspace) {
    workspace.archived = true;
  }

  const activeWorkspaces = config.workspaces.filter((w) => !w.archived);

  if (
    config.activeWorkspaceId === workspaceId ||
    (workspace && config.activeWorkspaceId === workspace.id)
  ) {
    config.activeWorkspaceId = activeWorkspaces.length > 0 ? activeWorkspaces[0].path : undefined;
  }
  await saveWorkspacesConfig(config);
  return config;
}
