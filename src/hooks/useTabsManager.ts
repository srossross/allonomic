import { useState, useCallback, useRef, useEffect } from "react";
import {
  type TabData,
  type ThinkingLevel,
  type ExecutionMode,
  type Project,
  AVAILABLE_MODES,
  INITIAL_TOOLS,
  THINKING_BUDGETS,
  DEFAULT_MODEL_ID,
  createInitialTab,
  createNewTab,
} from "@/types";
import { runAgentPromptApi, stopAgentPromptApi } from "@/agent/api";
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

  const { persistNewTab, persistCloseTab, persistTabSwitch, persistTabMetadata } =
    useTabsPersistence({
      activeProject,
      tabsRef,
      setTabs,
      setActiveTabId,
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
    (updater: (tab: TabData) => TabData) => {
      setTabs((previous) =>
        previous.map((t) => {
          if (t.id !== activeTab.id) return t;
          const updated = updater(t);
          persistTabMetadata(updated);
          return updated;
        })
      );
    },
    [activeTab.id, persistTabMetadata]
  );

  const handleSelectModel = useCallback(
    (modelId: string) => updateActiveTab((t) => ({ ...t, selectedModel: modelId })),
    [updateActiveTab]
  );
  const handleSelectThinkingLevel = useCallback(
    (level: ThinkingLevel) => updateActiveTab((t) => ({ ...t, thinkingLevel: level })),
    [updateActiveTab]
  );
  const handleSelectExecutionMode = useCallback(
    (mode: ExecutionMode) => updateActiveTab((t) => ({ ...t, executionMode: mode })),
    [updateActiveTab]
  );

  const handleCycleExecutionMode = useCallback(() => {
    updateActiveTab((t) => {
      const current = t.executionMode || "manual";
      const currentIndex = AVAILABLE_MODES.findIndex((m) => m.id === current);
      const nextIndex = (currentIndex + 1) % AVAILABLE_MODES.length;
      return { ...t, executionMode: AVAILABLE_MODES[nextIndex].id };
    });
  }, [updateActiveTab]);

  const handleStopMessage = useCallback(async () => {
    const currentTabId = activeTab.id;
    const controller = abortControllersReference.current.get(currentTabId);
    if (controller) {
      controller.abort();
      abortControllersReference.current.delete(currentTabId);
    }
    await stopAgentPromptApi(activeTab.threadId, currentTabId);
    setTabs((previous) =>
      previous.map((t) => (t.id === currentTabId ? { ...t, loading: false } : t))
    );
  }, [activeTab.id, activeTab.threadId]);

  const handleSendMessage = useCallback(
    async (text: string) => {
      const tab = activeTab;
      const thinkingLevel = tab.thinkingLevel || "High";
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
            config: {
              enabledTools: tab.enabledTools || INITIAL_TOOLS,
              modelName: tab.selectedModel || DEFAULT_MODEL_ID,
              thinkingBudget: THINKING_BUDGETS[thinkingLevel] ?? 8192,
              executionMode: tab.executionMode || "manual",
            },
          })
        );
      } finally {
        abortControllersReference.current.delete(tab.id);
      }
    },
    [activeTab, activeProject, runTurn]
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
      updateActiveTab((t) => {
        const current = t.enabledTools || INITIAL_TOOLS;
        const next = current.includes(toolName)
          ? current.filter((n) => n !== toolName)
          : [...current, toolName];
        return { ...t, enabledTools: next };
      });
    },
    [updateActiveTab]
  );

  const handleSetAllTools = useCallback(
    (isEnabled: boolean) =>
      updateActiveTab((t) => ({ ...t, enabledTools: isEnabled ? INITIAL_TOOLS : [] })),
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
    handleSendMessage,
    handleStopMessage,
    handleClearConsole,
    handleToggleContext,
    handleToggleTool,
    handleSetAllTools,
    runTurn,
  };
}
