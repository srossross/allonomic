import { open } from "@tauri-apps/plugin-dialog";

import { useState, useCallback, useEffect } from "react";
import type { GroupColor, Project, WorkspaceGroup, WorkspacesConfig } from "@/types";
import {
  fetchWorkspacesApi,
  addWorkspaceApi,
  setActiveWorkspaceApi,
  renameWorkspaceApi,
  deleteWorkspaceApi,
  createGroupApi,
  updateGroupApi,
  deleteGroupApi,
  setWorkspaceGroupApi,
} from "@/agent/api";
import { alertError, withAlert } from "@/lib/alertError";

export function useProjectManager(onNewTab?: () => void) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [groups, setGroups] = useState<WorkspaceGroup[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>("proj-1");

  const applyConfig = useCallback((config: WorkspacesConfig) => {
    setProjects(config.workspaces.filter((w) => !w.archived));
    setGroups(config.groups);
  }, []);

  useEffect(() => {
    async function loadWorkspaces() {
      const config = await fetchWorkspacesApi();
      setGroups(config.groups);
      if (!config.workspaces || config.workspaces.length === 0) return;
      setProjects(config.workspaces.filter((w) => !w.archived));
      if (config.activeWorkspaceId) setActiveProjectId(config.activeWorkspaceId);
    }
    void withAlert("Load workspaces", loadWorkspaces);
  }, []);

  const handleSelectProject = useCallback(async (id: string) => {
    setActiveProjectId(id);
    await withAlert("Save active workspace", () => setActiveWorkspaceApi(id));
  }, []);

  const handleAddProject = useCallback(async (name: string, projectPath: string) => {
    const newProjId = projectPath;
    const newProj: Project = { id: newProjId, name, path: projectPath };
    setProjects((previous) => [
      ...previous.filter((p) => p.id !== newProjId && p.path !== projectPath),
      newProj,
    ]);
    setActiveProjectId(newProjId);
    const config = await addWorkspaceApi(newProj);
    if (config.workspaces) {
      setProjects(config.workspaces.filter((w) => !w.archived));
    }
  }, []);

  const handleRenameProject = useCallback(async (id: string, newName: string) => {
    try {
      const config = await renameWorkspaceApi(id, newName);
      if (config.workspaces) setProjects(config.workspaces.filter((w) => !w.archived));
    } catch (error) {
      alertError("Rename workspace")(error);
    }
  }, []);

  const handleDeleteProject = useCallback(async (id: string) => {
    try {
      const config = await deleteWorkspaceApi(id);
      if (config.workspaces) {
        setProjects(config.workspaces.filter((w) => !w.archived));
        if (config.activeWorkspaceId) {
          setActiveProjectId(config.activeWorkspaceId);
        }
      }
    } catch (error) {
      alertError("Delete workspace")(error);
    }
  }, []);

  const handleCreateGroup = useCallback(
    async (name: string, color: GroupColor): Promise<string | undefined> => {
      try {
        const config = await createGroupApi(name, color);
        applyConfig(config);
        return config.groups.at(-1)?.id;
      } catch (error) {
        alertError("Create group")(error);
        return undefined;
      }
    },
    [applyConfig]
  );

  const handleUpdateGroup = useCallback(
    async (id: string, patch: Partial<Omit<WorkspaceGroup, "id">>) => {
      setGroups((previous) => previous.map((g) => (g.id === id ? { ...g, ...patch } : g)));
      try {
        applyConfig(await updateGroupApi(id, patch));
      } catch (error) {
        alertError("Update group")(error);
      }
    },
    [applyConfig]
  );

  const handleDeleteGroup = useCallback(
    async (id: string) => {
      try {
        applyConfig(await deleteGroupApi(id));
      } catch (error) {
        alertError("Delete group")(error);
      }
    },
    [applyConfig]
  );

  const handleSetProjectGroup = useCallback(
    async (projectId: string, groupId: string | undefined) => {
      setProjects((previous) => previous.map((p) => (p.id === projectId ? { ...p, groupId } : p)));
      try {
        applyConfig(await setWorkspaceGroupApi(projectId, groupId));
      } catch (error) {
        alertError("Move project to group")(error);
      }
    },
    [applyConfig]
  );

  const triggerDirPicker = useCallback(async () => {
    const selectedPath = await open({
      directory: true,
      multiple: false,
    });
    if (typeof selectedPath !== "string") return;
    const name = selectedPath.split(/[/\\]/).pop() || selectedPath;
    await handleAddProject(name, selectedPath);
  }, [handleAddProject]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCommandOrCtrl = e.metaKey || e.ctrlKey;
      if (isCommandOrCtrl && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void withAlert("Open folder", triggerDirPicker);
      } else if (onNewTab && isCommandOrCtrl && e.key.toLowerCase() === "t") {
        e.preventDefault();
        onNewTab();
      } else if (e.metaKey && e.key >= "1" && e.key <= "9") {
        const project = projects[Number(e.key) - 1];
        if (!project) return;
        e.preventDefault();
        void handleSelectProject(project.id);
      }
    };

    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [triggerDirPicker, onNewTab, projects, handleSelectProject]);

  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0];

  return {
    projects,
    activeProjectId,
    activeProject,
    setActiveProjectId: handleSelectProject,
    handleRenameProject,
    handleDeleteProject,
    groups,
    handleCreateGroup,
    handleUpdateGroup,
    handleDeleteGroup,
    handleSetProjectGroup,
    triggerDirPicker,
  };
}
