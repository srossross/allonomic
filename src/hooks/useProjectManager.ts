import { open } from "@tauri-apps/plugin-dialog";

import { useState, useCallback, useRef, useEffect } from "react";
import type { Project } from "@/types";
import {
  fetchWorkspacesApi,
  addWorkspaceApi,
  setActiveWorkspaceApi,
  renameWorkspaceApi,
  deleteWorkspaceApi,
} from "@/agent/api";

export function useProjectManager(onNewTab?: () => void) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>("proj-1");
  const globalDirPickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function loadWorkspaces() {
      try {
        const config = await fetchWorkspacesApi();
        if (config.workspaces && config.workspaces.length > 0) {
          const activeWorkspaces = config.workspaces.filter((w) => !w.archived);
          setProjects(activeWorkspaces);
          if (config.activeWorkspaceId) {
            setActiveProjectId(config.activeWorkspaceId);
          }
        }
      } catch (error) {
        console.warn("[ProjectManager] Could not load workspaces from persistence:", error);
      }
    }
    void loadWorkspaces();
  }, []);

  const handleSelectProject = useCallback(async (id: string) => {
    setActiveProjectId(id);
    try {
      await setActiveWorkspaceApi(id);
    } catch (error) {
      console.error("[ProjectManager] Failed to persist active workspace:", error);
      globalThis.alert(
        "Failed to save active workspace: " +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }, []);

  const handleAddProject = useCallback(async (name: string, projectPath: string) => {
    const newProjId = projectPath;
    const newProj: Project = { id: newProjId, name, path: projectPath };
    setProjects((previous) => [
      ...previous.filter((p) => p.id !== newProjId && p.path !== projectPath),
      newProj,
    ]);
    setActiveProjectId(newProjId);
    try {
      const config = await addWorkspaceApi(newProj);
      if (config.workspaces) {
        setProjects(config.workspaces.filter((w) => !w.archived));
      }
    } catch (error) {
      console.error("[ProjectManager] Failed to persist new workspace:", error);
      globalThis.alert(
        "Failed to create workspace: " + (error instanceof Error ? error.message : String(error))
      );
    }
  }, []);

  const handleRenameProject = useCallback(async (id: string, newName: string) => {
    try {
      const config = await renameWorkspaceApi(id, newName);
      if (config.workspaces) setProjects(config.workspaces.filter((w) => !w.archived));
    } catch (error) {
      console.error("[ProjectManager] Failed to rename workspace:", error);
      globalThis.alert(
        "Failed to rename workspace: " + (error instanceof Error ? error.message : String(error))
      );
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
      console.error("[ProjectManager] Failed to delete workspace:", error);
      globalThis.alert(
        "Failed to delete workspace: " + (error instanceof Error ? error.message : String(error))
      );
    }
  }, []);

  const triggerDirPicker = useCallback(async () => {
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
      });
      if (typeof selectedPath === "string") {
        const name = selectedPath.split(/[/\\]/).pop() || selectedPath;
        handleAddProject(name, selectedPath);
      }
      return;
    } catch (error) {
      console.warn("Tauri dialog failed, falling back", error);
    }

    if (globalThis.showDirectoryPicker) {
      try {
        const handle = await globalThis.showDirectoryPicker();
        if (handle?.name) {
          handleAddProject(handle.name, handle.name);
          return;
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") return;
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error("[ProjectManager] Directory picker failed:", error);
        globalThis.alert("Failed to open directory picker: " + errorMsg);
        return;
      }
    }

    globalDirPickerRef.current?.click();
  }, [handleAddProject]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCommandOrCtrl = e.metaKey || e.ctrlKey;
      if (isCommandOrCtrl && e.key.toLowerCase() === "n") {
        e.preventDefault();
        triggerDirPicker();
      } else if (onNewTab && isCommandOrCtrl && e.key.toLowerCase() === "t") {
        e.preventDefault();
        onNewTab();
      }
    };

    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [triggerDirPicker, onNewTab]);

  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0];

  return {
    projects,
    activeProjectId,
    activeProject,
    setActiveProjectId: handleSelectProject,
    handleAddProject,
    handleRenameProject,
    handleDeleteProject,
    triggerDirPicker,
    globalDirPickerRef,
  };
}
