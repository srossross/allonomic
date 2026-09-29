import { useState, useCallback, useRef, useEffect } from "react";
import {
  type TabData,
  type ThinkingLevel,
  type ExecutionMode,
  type Project,
  AVAILABLE_MODES,
  INITIAL_TOOLS,
  DEFAULT_EXECUTION_MODE,
  DEFAULT_GOVERNOR_MODE,
  GOVERNOR_MODES,
  createInitialTab,
  createNewTab,
} from "@/types";
import {
  fetchSessionSettingsApi,
  recoverSessionApi,
  runAgentPromptApi,
  stopAgentPromptApi,
} from "@/agent/api";
import { settingsToTab } from "./tabSettings";
import type { InterceptorSettings, SettingsPatch } from "@/core/config/settings";
import type { RecoverableCall } from "@/core/turn/events";
import { buildHistory } from "@/core/history";
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
          history: buildHistory(tab.messages),
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

  const activeProjectTabs = tabs.filter((t) => t.projectId === activeProject?.id);
  const activeTab =
    tabs.find((t) => t.id === activeTabId && t.projectId === activeProject?.id) ||
    activeProjectTabs.find((t) => t !== undefined) ||
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
    const newTab = createNewTab(activeProject.id, projectTabs.length + 1);
    const nextTabs = [...tabs, newTab];
    setTabs(nextTabs);
    setActiveTabId(newTab.id);
    persistNewTab(newTab, [...projectTabs, newTab]);
  }, [tabs, activeProject, persistNewTab]);

  const handleCloseTab = useCallback(
    (tabIdToClose: string) => {
      setTabs((previous) => {
        const projectTabs = previous.filter((t) => t.projectId === activeProject.id);
        if (projectTabs.length <= 1 && projectTabs[0].id === tabIdToClose) return previous;

        const filtered = previous.filter((t) => t.id !== tabIdToClose);
        const filteredProjectTabs = filtered.filter((t) => t.projectId === activeProject.id);
        const lastTab = filteredProjectTabs.at(-1);
        const nextActiveId = activeTabId === tabIdToClose && lastTab ? lastTab.id : activeTabId;

        if (activeTabId === tabIdToClose && lastTab) {
          setActiveTabId(lastTab.id);
        }

        const closingTab = previous.find((t) => t.id === tabIdToClose);
        persistCloseTab(
          tabIdToClose,
          nextActiveId,
          filteredProjectTabs,
          closingTab?.title || "Chat"
        );

        return filtered;
      });
    },
    [activeTabId, persistCloseTab, activeProject]
  );

  const updateActiveTab = useCallback(
    (patch: SettingsPatch) => persistTabSettings(activeTab.id, patch),
    [activeTab.id, persistTabSettings]
  );

  const handleSelectModel = useCallback(
    (modelId: string) => updateActiveTab({ model: modelId }),
    [updateActiveTab]
  );
  const handleSelectThinkingLevel = useCallback(
    (level: ThinkingLevel) => updateActiveTab({ thinkingLevel: level }),
    [updateActiveTab]
  );
  const handleSelectExecutionMode = useCallback(
    (mode: ExecutionMode) => updateActiveTab({ executionMode: mode }),
    [updateActiveTab]
  );

  const handleToggleHasNetworkAccess = useCallback(
    () => updateActiveTab({ networkAccess: !activeTab.hasNetworkAccess }),
    [updateActiveTab, activeTab.hasNetworkAccess]
  );

  const handleToggleTeacher = useCallback(
    () => updateActiveTab({ teacherEnabled: !(activeTab.teacherEnabled ?? true) }),
    [updateActiveTab, activeTab.teacherEnabled]
  );

  const handleSetInterceptorSettings = useCallback(
    (name: string, settings: InterceptorSettings) =>
      updateActiveTab({ interceptors: { [name]: settings } }),
    [updateActiveTab]
  );

  const handleCycleGovernorMode = useCallback(() => {
    const currentIndex = GOVERNOR_MODES.indexOf(activeTab.governorMode ?? DEFAULT_GOVERNOR_MODE);
    updateActiveTab({ governorMode: GOVERNOR_MODES[(currentIndex + 1) % GOVERNOR_MODES.length] });
  }, [updateActiveTab, activeTab.governorMode]);

  const handleCycleExecutionMode = useCallback(() => {
    const current = activeTab.executionMode || DEFAULT_EXECUTION_MODE;
    const currentIndex = AVAILABLE_MODES.findIndex((m) => m.id === current);
    const nextIndex = (currentIndex + 1) % AVAILABLE_MODES.length;
    updateActiveTab({ executionMode: AVAILABLE_MODES[nextIndex].id });
  }, [updateActiveTab, activeTab.executionMode]);

  const handleStopMessage = useCallback(async () => {
    const currentTabId = activeTab.id;
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
  }, [activeTab.id, activeTab.threadId]);

  const handleSendMessage = useCallback(
    async (text: string) => {
      const tab = activeTab;
      setTabs((previous) => previous.map((t) => (t.id === tab.id ? { ...t, loading: true } : t)));

      const controller = new AbortController();
      abortControllersReference.current.set(tab.id, controller);
      try {
        await runTurn(tab.id, (onEvent) =>
          runAgentPromptApi({
            prompt: text,
            threadId: tab.threadId,
            sessionId: tab.id,
            workspaceDir: activeProject?.path,
            history: buildHistory(tab.messages),
            signal: controller.signal,
            onEvent,
          })
        );
      } finally {
        abortControllersReference.current.delete(tab.id);
      }
      await refreshTabSettings(tab.id);
    },
    [activeTab, activeProject, runTurn, refreshTabSettings]
  );

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

  const handleToggleTool = useCallback(
    (toolName: string) => {
      const current = activeTab.enabledTools || INITIAL_TOOLS;
      updateActiveTab({ tools: { [toolName]: !current.includes(toolName) } });
    },
    [updateActiveTab, activeTab.enabledTools]
  );

  const handleSetAllTools = useCallback(
    (isEnabled: boolean) =>
      updateActiveTab({
        tools: Object.fromEntries(INITIAL_TOOLS.map((name) => [name, isEnabled])),
      }),
    [updateActiveTab]
  );

  return {
    tabs,
    setTabs,
    activeTabId,
    activeTab,
    setActiveTabId: handleSelectTab,
    handleNewTab,
    handleCloseTab,
    handleSelectModel,
    handleSelectThinkingLevel,
    handleSelectExecutionMode,
    handleCycleExecutionMode,
    handleToggleHasNetworkAccess,
    handleToggleTeacher,
    handleSetInterceptorSettings,
    handleCycleGovernorMode,
    handleSendMessage,
    handleStopMessage,
    handleClearConsole,
    handleToggleContext,
    handleToggleTool,
    handleSetAllTools,
    runTurn,
  };
}
