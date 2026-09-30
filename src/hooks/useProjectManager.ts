import { open } from "@tauri-apps/plugin-dialog";

import { useState, useCallback, useEffect } from "react";
import type { Project } from "@/types";
import {
  fetchWorkspacesApi,
  addWorkspaceApi,
  setActiveWorkspaceApi,
  renameWorkspaceApi,
  deleteWorkspaceApi,
} from "@/agent/api";
import { alertError, withAlert } from "@/lib/alertError";

export function useProjectManager(onNewTab?: () => void) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>("proj-1");

  useEffect(() => {
    async function loadWorkspaces() {
      const config = await fetchWorkspacesApi();
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
    triggerDirPicker,
  };
}
