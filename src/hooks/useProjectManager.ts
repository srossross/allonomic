import { useState, useCallback, useRef, useEffect } from "react";
import type { Project } from "@/types";
import { fetchWorkspacesApi, addWorkspaceApi, setActiveWorkspaceApi, getDevContainerStatusApi } from "@/agent/api";

export function useProjectManager(onNewTab?: () => void) {
  const [projects, setProjects] = useState<Project[]>([
    { id: "proj-1", name: "allonomic", path: "allonomic" },
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

  useEffect(() => {
    const pollStatuses = async () => {
      setProjects((currentProjects) => {
        const checkAll = async () => {
          const updated = await Promise.all(currentProjects.map(async (p) => {
            try {
              const res = await getDevContainerStatusApi(p.path);
              if (p.containerId !== res.containerId || p.devcontainerStatus !== res.status) {
                return { ...p, containerId: res.containerId, devcontainerStatus: res.status };
              }
            } catch {
              if (p.containerId !== null || p.devcontainerStatus !== "not_setup") {
                return { ...p, containerId: null, devcontainerStatus: "not_setup" };
              }
            }
            return p;
          }));
          
          const hasChanges = updated.some((p, i) => p.containerId !== currentProjects[i].containerId || p.devcontainerStatus !== currentProjects[i].devcontainerStatus);
          if (hasChanges) {
            setProjects(updated);
          }
        };
        void checkAll();
        return currentProjects;
      });
    };

    pollStatuses();
    const interval = setInterval(pollStatuses, 5000);
    return () => clearInterval(interval);
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
      const config = await addWorkspaceApi(newProj);
      if (config.workspaces) {
        setProjects(config.workspaces);
      }
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
