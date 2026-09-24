import { useState, useCallback, useRef, useEffect } from "react";
import type { Project } from "@/types";
import { fetchWorkspacesApi, addWorkspaceApi, setActiveWorkspaceApi } from "@/agent/api";

export function useProjectManager(onNewTab?: () => void) {
  const [projects, setProjects] = useState<Project[]>([
    { id: "proj-1", name: "atomic", path: "atomic" },
  ]);
  const [activeProjectId, setActiveProjectId] = useState<string>("proj-1");
  const globalDirPickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function loadWorkspaces() {
      try {
        const config = await fetchWorkspacesApi();
        if (config.workspaces && config.workspaces.length > 0) {
          setProjects(config.workspaces);
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
      console.warn("[ProjectManager] Failed to persist active workspace:", error);
    }
  }, []);

  const handleAddProject = useCallback(async (name: string, projectPath: string) => {
    const newProjId = `proj-${Date.now()}`;
    const newProj: Project = { id: newProjId, name, path: projectPath };
    setProjects((previous) => [
      ...previous.filter((p) => p.id !== newProjId && p.path !== projectPath),
      newProj,
    ]);
    setActiveProjectId(newProjId);
    try {
      await addWorkspaceApi(newProj);
    } catch (error) {
      console.warn("[ProjectManager] Failed to persist new workspace:", error);
    }
  }, []);

  const triggerDirPicker = useCallback(async () => {
    if (globalThis.showDirectoryPicker) {
      try {
        const handle = await globalThis.showDirectoryPicker();
        if (handle?.name) {
          handleAddProject(handle.name, handle.name);
          return;
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") return;
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
    triggerDirPicker,
    globalDirPickerRef,
  };
}
