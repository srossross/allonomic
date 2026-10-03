import { readTextFile, writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
import { join, resolve, dirname } from "@tauri-apps/api/path";
import YAML from "yaml";
import { tauriRuntime } from "../adapters/tauri/runtime";
import type { WorkspacesConfig, WorkspaceItem, WorkspaceGroup } from "../types/persistence";
import type { GroupColor } from "../types/groupColors";
import { isNotFound } from "../core/fsErrors";
import { parseGroups, readGroupId, removeGroup, serializeGroups } from "./workspaceGroups";

async function getWorkspacesFilePath(): Promise<string> {
  const configDir = await tauriRuntime.paths.appConfig();
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

      const groups = parseGroups(Reflect.get(data, "groups"));
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
              groupId: readGroupId(val, groups),
            });
          }
        }

        if (validWorkspaces.length > 0 || groups.length > 0) {
          const resolvedActiveId = activeWorkspaceId?.startsWith("proj-")
            ? undefined
            : activeWorkspaceId;

          return {
            activeWorkspaceId: resolvedActiveId || validWorkspaces[0]?.path,
            workspaces: validWorkspaces,
            groups,
          };
        }
      }
    }
  } catch (error) {
    if (!isNotFound(error)) {
      const errorMsg = error instanceof Error ? error.message : String(error);
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
    groups: [],
  };

  await saveWorkspacesConfig(initialConfig);

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
      ...(w.groupId && { group: w.groupId }),
    };
  }

  const yml = YAML.stringify({
    active_workspace_id: config.activeWorkspaceId,
    groups: serializeGroups(config.groups),
    workspaces: workspacesMap,
  });
  await writeTextFile(filePath, yml);
}

export async function addOrUpdateWorkspace(workspace: WorkspaceItem): Promise<WorkspacesConfig> {
  const config = await loadWorkspacesConfig();

  workspace.path = await resolve(workspace.path);
  workspace.id = workspace.path;

  const index = config.workspaces.findIndex((w) => w.path === workspace.path);

  const updatedItem: WorkspaceItem = {
    ...workspace,
    groupId: workspace.groupId ?? config.workspaces[index]?.groupId,
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

export async function createGroup(name: string, color: GroupColor): Promise<WorkspacesConfig> {
  const config = await loadWorkspacesConfig();
  config.groups.push({ id: `g-${crypto.randomUUID()}`, name, color });
  await saveWorkspacesConfig(config);
  return config;
}

export async function updateGroup(
  groupId: string,
  patch: Partial<Omit<WorkspaceGroup, "id">>
): Promise<WorkspacesConfig> {
  const config = await loadWorkspacesConfig();
  const group = config.groups.find((g) => g.id === groupId);
  if (group) {
    Object.assign(group, patch);
    await saveWorkspacesConfig(config);
  }
  return config;
}

export async function deleteGroup(groupId: string): Promise<WorkspacesConfig> {
  const config = await loadWorkspacesConfig();
  removeGroup(config, groupId);
  await saveWorkspacesConfig(config);
  return config;
}

export async function setWorkspaceGroup(
  workspaceId: string,
  groupId: string | undefined
): Promise<WorkspacesConfig> {
  const config = await loadWorkspacesConfig();
  const found = config.workspaces.find((w) => w.id === workspaceId || w.path === workspaceId);
  if (found && (groupId === undefined || config.groups.some((g) => g.id === groupId))) {
    found.groupId = groupId;
    await saveWorkspacesConfig(config);
  }
  return config;
}
