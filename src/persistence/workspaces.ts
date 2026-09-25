import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import YAML from "yaml";
import { getAppConfigDir } from "./configPaths";
import type { WorkspacesConfig, WorkspaceItem } from "../types/persistence";

export function getWorkspacesFilePath(): string {
  return path.join(getAppConfigDir(), "workspaces.yml");
}

function getDefaultWorkspace(): WorkspaceItem {
  const cwd = process.cwd();
  const defaultName = path.basename(cwd) || "default-workspace";

  return {
    id: "proj-1",
    name: defaultName,
    path: cwd,
    lastOpened: new Date().toISOString(),
  };
}

function isWorkspaceItem(item: unknown): item is WorkspaceItem {
  if (!item || typeof item !== "object") return false;
  const id = Reflect.get(item, "id");
  const name = Reflect.get(item, "name");
  const workspacePath = Reflect.get(item, "path");
  return typeof id === "string" && typeof name === "string" && typeof workspacePath === "string";
}

export async function loadWorkspacesConfig(): Promise<WorkspacesConfig> {
  const filePath = getWorkspacesFilePath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data: unknown = YAML.parse(raw);
    if (data && typeof data === "object") {
      const activeRaw =
        Reflect.get(data, "active_workspace_id") || Reflect.get(data, "activeWorkspaceId");
      const activeWorkspaceId = typeof activeRaw === "string" ? activeRaw : undefined;

      const workspacesRaw = Reflect.get(data, "workspaces");
      if (Array.isArray(workspacesRaw)) {
        const validWorkspaces = workspacesRaw.filter(isWorkspaceItem);
        if (validWorkspaces.length > 0) {
          return {
            activeWorkspaceId: activeWorkspaceId || validWorkspaces[0].id,
            workspaces: validWorkspaces,
          };
        }
      }
    }
  } catch {
    // File not found or unparseable, will initialize default below
  }

  const defaultItem = getDefaultWorkspace();
  const initialConfig: WorkspacesConfig = {
    activeWorkspaceId: defaultItem.id,
    workspaces: [defaultItem],
  };

  try {
    await saveWorkspacesConfig(initialConfig);
  } catch (error) {
    console.warn(`[WorkspacesConfig] Unable to save initial workspaces config:`, error);
  }

  return initialConfig;
}

export async function saveWorkspacesConfig(config: WorkspacesConfig): Promise<void> {
  const filePath = getWorkspacesFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const yml = YAML.stringify({
    active_workspace_id: config.activeWorkspaceId,
    workspaces: config.workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      path: w.path,
      last_opened: w.lastOpened,
    })),
  });
  await fs.writeFile(filePath, yml, "utf8");
}

export async function addOrUpdateWorkspace(workspace: WorkspaceItem): Promise<WorkspacesConfig> {
  const config = await loadWorkspacesConfig();
  const index = config.workspaces.findIndex((w) => w.id === workspace.id || w.path === workspace.path);

  const updatedItem: WorkspaceItem = {
    ...workspace,
    lastOpened: new Date().toISOString(),
  };

  if (index === -1) {
    config.workspaces.push(updatedItem);
  } else {
    config.workspaces[index] = updatedItem;
  }

  config.activeWorkspaceId = updatedItem.id;
  await saveWorkspacesConfig(config);
  return config;
}

export async function setActiveWorkspaceId(workspaceId: string): Promise<WorkspacesConfig> {
  const config = await loadWorkspacesConfig();
  const found = config.workspaces.find((w) => w.id === workspaceId);
  if (found) {
    found.lastOpened = new Date().toISOString();
  }
  config.activeWorkspaceId = workspaceId;
  await saveWorkspacesConfig(config);
  return config;
}
