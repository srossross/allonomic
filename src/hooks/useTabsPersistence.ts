import { useEffect, useCallback } from "react";
import { type TabData, type Project, PLACEHOLDER_TAB_ID } from "@/types";
import {
  fetchWorkspaceStateApi,
  saveWorkspaceStateApi,
  fetchSessionsApi,
  rehydrateSessionApi,
  saveSessionMetadataApi,
  fetchSessionSettingsApi,
  updateSessionSettingsApi,
} from "@/agent/api";
import type { Settings, SettingsPatch } from "@/core/config/settings";
import { EMPTY_GOVERNOR_STATE } from "@/core/governor/reducer";
import type { RecoverableCall } from "@/core/turn/events";
import { settingsToTab } from "./tabSettings";

interface UseTabsPersistenceParameters {
  activeProject: Project;
  tabsRef: React.RefObject<TabData[]>;
  setTabs: React.Dispatch<React.SetStateAction<TabData[]>>;
  setActiveTabId: (id: string) => void;
  recoverTab: (tab: TabData, calls: RecoverableCall[]) => Promise<void>;
}

export function useTabsPersistence({
  activeProject,
  tabsRef,
  setTabs,
  setActiveTabId,
  recoverTab,
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
          const recoveries: Array<{ tab: TabData; calls: RecoverableCall[] }> = [];
          for (const sessionId of tabIdsToLoad) {
            try {
              const rehydrated = await rehydrateSessionApi(activeProject.path, sessionId);
              const settings = await fetchSessionSettingsApi(activeProject.path, sessionId);
              const tab: TabData = {
                id: rehydrated.metadata.sessionId,
                title: rehydrated.metadata.title,
                projectId: activeProject.id,
                threadId: rehydrated.metadata.sessionId,
                messages: rehydrated.messages,
                contextMessages: rehydrated.contextMessages,
                consoleEvents: rehydrated.consoleEvents,
                agentFiles: rehydrated.agentFiles,
                governorState: rehydrated.governorState,
                loading: false,
                ...settingsToTab(settings),
                loadErrors: rehydrated.loadErrors,
                contextTokens: rehydrated.contextTokens,
                profile: rehydrated.profile,
              };
              loadedTabs.push(tab);
              if (rehydrated.unansweredCalls.length > 0)
                recoveries.push({ tab, calls: rehydrated.unansweredCalls });
            } catch (error) {
              console.error(`[TabsPersistence] Failed to rehydrate session ${sessionId}:`, error);
              loadedTabs.push({
                id: sessionId,
                title: sessionId,
                projectId: activeProject.id,
                threadId: sessionId,
                messages: [],
                governorState: EMPTY_GOVERNOR_STATE,
                loading: false,
                loadErrors: [
                  {
                    turnIndex: null,
                    message: error instanceof Error ? error.message : String(error),
                  },
                ],
              });
            }
          }

          if (!isCancelled && loadedTabs.length > 0) {
            const existingProjectTabs = (tabsRef.current || []).filter(
              (t) => t.projectId === activeProject.id
            );
            if (existingProjectTabs.length === 0) {
              setTabs((prev) => [
                ...prev.filter((t) => t.id !== PLACEHOLDER_TAB_ID),
                ...loadedTabs,
              ]);
              for (const { tab, calls } of recoveries) void recoverTab(tab, calls);
            }
            const targetActive =
              state?.activeTabId && loadedTabs.some((t) => t.id === state.activeTabId)
                ? state.activeTabId
                : loadedTabs[0].id;
            setActiveTabId(targetActive);
            return;
          }
        }

        const initialId = `session-${Date.now()}`;
        const settings = await fetchSessionSettingsApi(activeProject.path, initialId);
        const initialTab: TabData = {
          id: initialId,
          title: "Chat 1",
          projectId: activeProject.id,
          threadId: initialId,
          messages: [],
          governorState: {
            intent_stack: [],
            completed_intents: [],
            false_completions: [],
          },
          loading: false,
          ...settingsToTab(settings),
        };

        if (!isCancelled) {
          const existingProjectTabs = (tabsRef.current || []).filter(
            (t) => t.projectId === activeProject.id
          );
          if (existingProjectTabs.length === 0) {
            setTabs((prev) => [...prev.filter((t) => t.id !== PLACEHOLDER_TAB_ID), initialTab]);
            setActiveTabId(initialId);
          } else {
            setActiveTabId(state?.activeTabId ?? existingProjectTabs[0].id);
          }
        }

        void saveSessionMetadataApi(activeProject.path, {
          sessionId: initialId,
          title: initialTab.title,
          closed: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        void saveWorkspaceStateApi(activeProject.path, {
          activeTabId: initialId,
          openTabIds: [initialId],
        });
      } catch (error) {
        console.error("[TabsPersistence] Failed to load workspace tabs:", error);
        globalThis.alert(
          "Failed to load workspace tabs: " +
            (error instanceof Error ? error.message : String(error))
        );
      }
    }

    void loadWorkspaceTabs();

    return () => {
      isCancelled = true;
    };
  }, [activeProject?.id, activeProject?.path, tabsRef, setTabs, setActiveTabId, recoverTab]);

  const applySettings = useCallback(
    async (tabId: string, pending: Promise<Settings>) => {
      try {
        const tabSettings = settingsToTab(await pending);
        setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...tabSettings } : t)));
      } catch (error) {
        console.error("[TabsPersistence] Failed to apply session settings:", error);
        globalThis.alert(
          "Failed to apply session settings: " +
            (error instanceof Error ? error.message : String(error))
        );
      }
    },
    [setTabs]
  );

  const persistNewTab = useCallback(
    (newTab: TabData, nextTabs: TabData[]) => {
      if (!activeProject?.path) return;
      void saveSessionMetadataApi(activeProject.path, {
        sessionId: newTab.id,
        title: newTab.title,
        closed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      void applySettings(newTab.id, fetchSessionSettingsApi(activeProject.path, newTab.id));

      void saveWorkspaceStateApi(activeProject.path, {
        activeTabId: newTab.id,
        openTabIds: nextTabs.map((t) => t.id),
      });
    },
    [activeProject, applySettings]
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

  const persistTabSettings = useCallback(
    (tabId: string, patch: SettingsPatch) => {
      if (!activeProject?.path) return;
      void applySettings(tabId, updateSessionSettingsApi(activeProject.path, tabId, patch));
    },
    [activeProject, applySettings]
  );

  return {
    persistNewTab,
    persistCloseTab,
    persistTabSwitch,
    persistTabSettings,
  };
}
