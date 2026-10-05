import { useState, useCallback, useRef, useEffect } from "react";
import {
  type TabData,
  type Project,
  DEFAULT_CHAT_TITLE,
  createInitialTab,
  createNewTab,
  createSettingsTab,
  SETTINGS_TAB_ID,
} from "@/types";
import {
  fetchSessionSettingsApi,
  recoverSessionApi,
  runAgentPromptApi,
  stopAgentPromptApi,
} from "@/agent/api";
import { useBranching } from "./useBranching";
import { useTabSettingsHandlers } from "./useTabSettingsHandlers";
import { useTurnQueue, type StartTurn } from "./useTurnQueue";
import { settingsToTab } from "./tabSettings";
import type { RecoverableCall } from "@/core/turn/events";
import { useTabsPersistence } from "./useTabsPersistence";
import { useTurnDispatch } from "./useTurnDispatch";

export function useTabsManager(activeProject: Project) {
  const [tabs, setTabs] = useState<TabData[]>([createInitialTab(activeProject?.id || "proj-1")]);
  const [activeTabId, setActiveTabId] = useState<string>("tab-1");
  const abortControllersReference = useRef<Map<string, AbortController>>(new Map());
  const activeTabIdRef = useRef(activeTabId);
  const tabsRef = useRef(tabs);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const runTurn = useTurnDispatch(setTabs, activeTabIdRef);

  const projectPath = activeProject?.path;
  const refreshTabSettings = useCallback(
    async (tabId: string) => {
      if (!projectPath) return;
      const tabSettings = settingsToTab(await fetchSessionSettingsApi(projectPath, tabId));
      setTabs((previous) => previous.map((t) => (t.id === tabId ? { ...t, ...tabSettings } : t)));
    },
    [projectPath]
  );

  const recoverTab = useCallback(
    async (tab: TabData, calls: RecoverableCall[]) => {
      setTabs((previous) => previous.map((t) => (t.id === tab.id ? { ...t, loading: true } : t)));
      await runTurn(tab.id, (onEvent) =>
        recoverSessionApi({
          threadId: tab.threadId,
          sessionId: tab.id,
          workspaceDir: projectPath,
          calls,
          onEvent,
        })
      );
      await refreshTabSettings(tab.id);
    },
    [runTurn, projectPath, refreshTabSettings]
  );

  const { persistNewTab, persistCloseTab, persistTabSwitch, persistTabSettings } =
    useTabsPersistence({
      activeProject,
      tabsRef,
      setTabs,
      setActiveTabId,
      recoverTab,
    });

  const activeTab =
    tabs.find((t) => t.id === activeTabId && t.projectId === activeProject?.id) ||
    tabs.find((t) => t.projectId === activeProject?.id) ||
    tabs[0];

  const handleSelectTab = useCallback(
    (tabId: string) => {
      setActiveTabId(tabId);
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, hasUnread: false } : t)));
      const projectTabs = tabs.filter((t) => t.projectId === activeProject?.id);
      persistTabSwitch(tabId, projectTabs);
    },
    [persistTabSwitch, tabs, setTabs, activeProject]
  );

  const handleNewTab = useCallback(() => {
    const projectTabs = tabs.filter((t) => t.projectId === activeProject?.id);
    const newTab = createNewTab(activeProject.id);
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    persistNewTab(newTab, [...projectTabs, newTab]);
  }, [tabs, activeProject, persistNewTab]);

  const handleCloseTab = useCallback(
    (tabIdToClose: string) => {
      const previous = tabsRef.current;
      const projectTabs = previous.filter((t) => t.projectId === activeProject.id);
      if (projectTabs.length <= 1 && projectTabs[0]?.id === tabIdToClose) return;

      const filtered = previous.filter(
        (t) => t.id !== tabIdToClose || t.projectId !== activeProject.id
      );
      const filteredProjectTabs = filtered.filter((t) => t.projectId === activeProject.id);
      const lastTab = filteredProjectTabs.at(-1);
      const nextActiveId = activeTabId === tabIdToClose && lastTab ? lastTab.id : activeTabId;

      setTabs((prev) =>
        prev.filter((t) => t.id !== tabIdToClose || t.projectId !== activeProject.id)
      );
      if (activeTabId === tabIdToClose && lastTab) {
        setActiveTabId(lastTab.id);
      }

      const closingTab = previous.find((t) => t.id === tabIdToClose);
      persistCloseTab(
        tabIdToClose,
        nextActiveId,
        filteredProjectTabs,
        closingTab?.title || DEFAULT_CHAT_TITLE
      );
    },
    [activeTabId, persistCloseTab, activeProject]
  );

  const settingsHandlers = useTabSettingsHandlers(activeTab, persistTabSettings);

  const startTurn = useCallback<StartTurn>(
    async (tab, text, onTurnEvent) => {
      setTabs((previous) => previous.map((t) => (t.id === tab.id ? { ...t, loading: true } : t)));
      const controller = new AbortController();
      abortControllersReference.current.set(tab.id, controller);
      try {
        await runTurn(tab.id, async (onEvent) => {
          const { title } = await runAgentPromptApi({
            prompt: text,
            threadId: tab.threadId,
            sessionId: tab.id,
            workspaceDir: activeProject?.path,
            signal: controller.signal,
            onEvent: (event) => {
              onEvent(event);
              onTurnEvent(event);
            },
          });
          if (title) {
            setTabs((previous) => previous.map((t) => (t.id === tab.id ? { ...t, title } : t)));
          }
        });
      } finally {
        abortControllersReference.current.delete(tab.id);
      }
      await refreshTabSettings(tab.id);
    },
    [activeProject, runTurn, refreshTabSettings]
  );

  const queue = useTurnQueue(setTabs, startTurn);

  const openSettingsTab = useCallback(() => {
    const projectTabs = tabsRef.current.filter((t) => t.projectId === activeProject.id);
    if (projectTabs.every((t) => t.id !== SETTINGS_TAB_ID)) {
      const settingsTab = createSettingsTab(activeProject.id);
      projectTabs.push(settingsTab);
      setTabs((previous) => [...previous, settingsTab]);
    }
    setActiveTabId(SETTINGS_TAB_ID);
    persistTabSwitch(SETTINGS_TAB_ID, projectTabs);
  }, [activeProject, persistTabSwitch]);

  const handleSendMessage = useCallback(
    (text: string) => (text === "/settings" ? openSettingsTab() : queue.send(activeTab, text)),
    [queue, activeTab, openSettingsTab]
  );
  const handlePause = useCallback(() => queue.pause(activeTab), [queue, activeTab]);
  const handleResume = useCallback(
    (text: string) => queue.resume(activeTab, text),
    [queue, activeTab]
  );
  const handleRemoveQueued = useCallback(
    (id: string) => queue.didRemove(activeTab, id),
    [queue, activeTab]
  );
  const handlePopQueued = useCallback(() => queue.pop(activeTab), [queue, activeTab]);

  const handleStopMessage = useCallback(async () => {
    const currentTabId = activeTab.id;
    queue.hold(activeTab);
    if (!activeTab.loading) return;
    const controller = abortControllersReference.current.get(currentTabId);
    if (controller) {
      controller.abort();
      abortControllersReference.current.delete(currentTabId);
    }
    try {
      await stopAgentPromptApi(activeTab.threadId, currentTabId);
    } finally {
      setTabs((previous) =>
        previous.map((t) => (t.id === currentTabId ? { ...t, loading: false } : t))
      );
    }
  }, [activeTab, queue]);

  const { handleRewind, handleSwitchBranch, handleFork } = useBranching({
    activeTab,
    projectPath,
    tabsRef,
    setTabs,
    setActiveTabId,
    persistTabSwitch,
  });

  const handleRetry = useCallback(() => recoverTab(activeTab, []), [recoverTab, activeTab]);

  const handleSettingsSaved = useCallback(async () => {
    const chats = tabsRef.current.filter((t) => t.projectId === activeProject?.id && !t.kind);
    await Promise.all(chats.map((t) => refreshTabSettings(t.id)));
  }, [activeProject?.id, refreshTabSettings]);

  const handleClearConsole = useCallback(
    (targetTabId?: string) => {
      const id = targetTabId || activeTab.id;
      setTabs((previous) => previous.map((t) => (t.id === id ? { ...t, consoleEvents: [] } : t)));
    },
    [activeTab.id]
  );

  const handleToggleContext = useCallback(
    (targetTabId?: string) => {
      const id = targetTabId || activeTab.id;
      setTabs((previous) =>
        previous.map((t) => (t.id === id ? { ...t, showContext: !t.showContext } : t))
      );
    },
    [activeTab.id]
  );

  return {
    tabs,
    activeTabId,
    activeTab,
    setActiveTabId: handleSelectTab,
    handleNewTab,
    handleCloseTab,
    ...settingsHandlers,
    handleSendMessage,
    handleStopMessage,
    handlePause,
    handleResume,
    handleRemoveQueued,
    handlePopQueued,
    handleRetry,
    handleRewind,
    handleSwitchBranch,
    handleFork,
    handleClearConsole,
    handleToggleContext,
    handleSettingsSaved,
  };
}
