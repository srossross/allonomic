import { useEffect, useCallback } from "react";
import { type TabData, type Project, INITIAL_TOOLS } from "@/types";
import {
  fetchWorkspaceStateApi,
  saveWorkspaceStateApi,
  fetchSessionsApi,
  rehydrateSessionApi,
  saveSessionMetadataApi,
} from "@/agent/api";

interface UseTabsPersistenceParameters {
  activeProject: Project;
  setTabs: React.Dispatch<React.SetStateAction<TabData[]>>;
  setActiveTabId: (id: string) => void;
}

export function useTabsPersistence({
  activeProject,
  setTabs,
  setActiveTabId,
}: UseTabsPersistenceParameters) {
  useEffect(() => {
    let isCancelled = false;

    async function loadWorkspaceTabs() {
      if (!activeProject?.path) return;

      try {
        const { state } = await fetchWorkspaceStateApi(activeProject.path);
        let tabIdsToLoad: string[] = state?.openTabIds || [];

        if (tabIdsToLoad.length === 0) {
          const { sessions } = await fetchSessionsApi(activeProject.path);
          const openSessions = sessions.filter((s) => !s.closed);
          if (openSessions.length > 0) {
            tabIdsToLoad = openSessions.map((s) => s.sessionId);
          }
        }

        if (tabIdsToLoad.length > 0) {
          const loadedTabs: TabData[] = [];
          for (const sessionId of tabIdsToLoad) {
            try {
              const rehydrated = await rehydrateSessionApi(activeProject.path, sessionId);
              loadedTabs.push({
                id: rehydrated.metadata.sessionId,
                title: rehydrated.metadata.title,
                projectId: activeProject.id,
                threadId: rehydrated.metadata.sessionId,
                messages: rehydrated.messages,
                contextMessages: rehydrated.contextMessages,
                consoleEvents: rehydrated.consoleEvents,
                enabledTools: rehydrated.metadata.enabledTools || INITIAL_TOOLS,
                governorState: rehydrated.governorState,
                loading: false,
                selectedModel: rehydrated.metadata.model || "gemini-2.5-flash",
                thinkingLevel: rehydrated.metadata.thinkingLevel || "High",
                executionMode: rehydrated.metadata.executionMode || "manual",
              });
            } catch (error) {
              console.warn(`[TabsPersistence] Failed to rehydrate session ${sessionId}:`, error);
            }
          }

          if (!isCancelled && loadedTabs.length > 0) {
            setTabs(loadedTabs);
            const targetActive =
              state?.activeTabId && loadedTabs.some((t) => t.id === state.activeTabId)
                ? state.activeTabId
                : loadedTabs[0].id;
            setActiveTabId(targetActive);
            return;
          }
        }

        const initialId = `session-${Date.now()}`;
        const initialTab: TabData = {
          id: initialId,
          title: "Chat 1",
          projectId: activeProject.id,
          threadId: initialId,
          messages: [],
          enabledTools: INITIAL_TOOLS,
          governorState: {
            intent_stack: [],
            completed_intents: [],
            global_constraints: [],
          },
          loading: false,
          selectedModel: "gemini-2.5-flash",
          thinkingLevel: "High",
          executionMode: "manual",
        };

        if (!isCancelled) {
          setTabs([initialTab]);
          setActiveTabId(initialId);
        }

        void saveSessionMetadataApi(activeProject.path, {
          sessionId: initialId,
          title: initialTab.title,
          closed: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          model: initialTab.selectedModel,
          thinkingLevel: initialTab.thinkingLevel,
          executionMode: initialTab.executionMode,
          enabledTools: initialTab.enabledTools,
        });

        void saveWorkspaceStateApi(activeProject.path, {
          activeTabId: initialId,
          openTabIds: [initialId],
        });
      } catch (error) {
        console.warn("[TabsPersistence] Failed to load workspace tabs:", error);
      }
    }

    void loadWorkspaceTabs();

    return () => {
      isCancelled = true;
    };
  }, [activeProject, setTabs, setActiveTabId]);

  const persistNewTab = useCallback(
    (newTab: TabData, nextTabs: TabData[]) => {
      if (!activeProject?.path) return;
      void saveSessionMetadataApi(activeProject.path, {
        sessionId: newTab.id,
        title: newTab.title,
        closed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        model: newTab.selectedModel,
        thinkingLevel: newTab.thinkingLevel,
        executionMode: newTab.executionMode,
        enabledTools: newTab.enabledTools,
      });

      void saveWorkspaceStateApi(activeProject.path, {
        activeTabId: newTab.id,
        openTabIds: nextTabs.map((t) => t.id),
      });
    },
    [activeProject]
  );

  const persistCloseTab = useCallback(
    (tabIdToClose: string, nextActiveId: string, remainingTabs: TabData[], title = "Chat") => {
      if (!activeProject?.path) return;
      void saveSessionMetadataApi(activeProject.path, {
        sessionId: tabIdToClose,
        title,
        closed: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      void saveWorkspaceStateApi(activeProject.path, {
        activeTabId: nextActiveId,
        openTabIds: remainingTabs.map((t) => t.id),
      });
    },
    [activeProject]
  );

  const persistTabSwitch = useCallback(
    (tabId: string, allTabs: TabData[]) => {
      if (!activeProject?.path) return;
      void saveWorkspaceStateApi(activeProject.path, {
        activeTabId: tabId,
        openTabIds: allTabs.map((t) => t.id),
      });
    },
    [activeProject]
  );

  const persistTabMetadata = useCallback(
    (tab: TabData) => {
      if (!activeProject?.path) return;
      void saveSessionMetadataApi(activeProject.path, {
        sessionId: tab.id,
        title: tab.title,
        closed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        model: tab.selectedModel,
        thinkingLevel: tab.thinkingLevel,
        executionMode: tab.executionMode,
        enabledTools: tab.enabledTools,
      });
    },
    [activeProject]
  );

  return {
    persistNewTab,
    persistCloseTab,
    persistTabSwitch,
    persistTabMetadata,
  };
}
