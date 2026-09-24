import { useState, useCallback, useRef } from "react";
import {
  type TabData,
  type Message,
  type ConsoleEvent,
  type ThinkingLevel,
  type ExecutionMode,
  type Project,
  AVAILABLE_MODES,
  INITIAL_TOOLS,
  THINKING_BUDGETS,
  createInitialTab,
  createNewTab,
} from "@/types";
import { runAgentPromptApi, stopAgentPromptApi } from "@/agent/api";
import { useTabsPersistence } from "./useTabsPersistence";

export function useTabsManager(activeProject: Project) {
  const [tabs, setTabs] = useState<TabData[]>([createInitialTab(activeProject?.id || "proj-1")]);
  const [activeTabId, setActiveTabId] = useState<string>("tab-1");
  const abortControllersReference = useRef<Map<string, AbortController>>(new Map());

  const { persistNewTab, persistCloseTab, persistTabSwitch, persistTabMetadata } =
    useTabsPersistence({
      activeProject,
      setTabs,
      setActiveTabId,
    });

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  const handleSelectTab = useCallback(
    (tabId: string) => {
      setActiveTabId(tabId);
      persistTabSwitch(tabId, tabs);
    },
    [persistTabSwitch, tabs]
  );

  const handleNewTab = useCallback(() => {
    const newTab = createNewTab(activeProject.id, tabs.length + 1);
    const nextTabs = [...tabs, newTab];
    setTabs(nextTabs);
    setActiveTabId(newTab.id);
    persistNewTab(newTab, nextTabs);
  }, [tabs, activeProject, persistNewTab]);


  const handleCloseTab = useCallback(
    (tabIdToClose: string) => {
      setTabs((previous) => {
        if (previous.length <= 1) return previous;
        const filtered = previous.filter((t) => t.id !== tabIdToClose);
        const lastTab = filtered.at(-1);
        const nextActiveId = activeTabId === tabIdToClose && lastTab ? lastTab.id : activeTabId;

        if (activeTabId === tabIdToClose && lastTab) {
          setActiveTabId(lastTab.id);
        }

        const closingTab = previous.find((t) => t.id === tabIdToClose);
        persistCloseTab(tabIdToClose, nextActiveId, filtered, closingTab?.title || "Chat");

        return filtered;
      });
    },
    [activeTabId, persistCloseTab]
  );

  const updateActiveTab = useCallback(
    (updater: (tab: TabData) => TabData) => {
      setTabs((previous) =>
        previous.map((t) => {
          if (t.id !== activeTabId) return t;
          const updated = updater(t);
          persistTabMetadata(updated);
          return updated;
        })
      );
    },
    [activeTabId, persistTabMetadata]
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
    const currentThreadId = activeTab.threadId;

    const controller = abortControllersReference.current.get(currentTabId);
    if (controller) {
      controller.abort();
      abortControllersReference.current.delete(currentTabId);
    }

    await stopAgentPromptApi(currentThreadId, currentTabId);

    const stopEvent: ConsoleEvent = {
      id: `stop-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      type: "warning",
      badge: "STOP",
      badgeVariant: "destructive",
      summary: "Generation stopped by user",
      details: { threadId: currentThreadId },
    };

    setTabs((previous) =>
      previous.map((t) => {
        if (t.id !== currentTabId) return t;
        return {
          ...t,
          loading: false,
          consoleEvents: [...(t.consoleEvents || []), stopEvent],
        };
      })
    );
  }, [activeTab.id, activeTab.threadId]);

  const handleSendMessage = useCallback(
    async (text: string) => {
      const currentTabId = activeTab.id;
      const currentThreadId = activeTab.threadId;
      const currentTools = activeTab.enabledTools || INITIAL_TOOLS;
      const currentModel = activeTab.selectedModel || "gemini-2.5-flash";
      const currentThinkingLevel = activeTab.thinkingLevel || "High";
      const thinkingBudget = THINKING_BUDGETS[currentThinkingLevel] ?? 8192;
      const workspaceDir = activeProject?.path;

      const userMessage: Message = { id: String(Date.now()), role: "user", content: text };

      setTabs((previous) =>
        previous.map((t) =>
          t.id === currentTabId
            ? { ...t, messages: [...t.messages, userMessage], loading: true }
            : t
        )
      );

      const controller = new AbortController();
      abortControllersReference.current.set(currentTabId, controller);

      try {
        const data = await runAgentPromptApi({
          prompt: text,
          threadId: currentThreadId,
          sessionId: currentTabId,
          workspaceDir,
          enabledTools: currentTools,
          modelName: currentModel,
          thinkingBudget,
          executionMode: activeTab.executionMode || "manual",
          history: activeTab.messages.map((m) => ({ role: m.role, content: m.content })),
          signal: controller.signal,
        });

        setTabs((previous) =>
          previous.map((t) => {
            if (t.id !== currentTabId) return t;

            const updatedMessages: Message[] = [...t.messages];
            if (data.assistantMessage || (data.toolCalls && data.toolCalls.length > 0)) {
              updatedMessages.push({
                id: String(Date.now() + 1),
                role: "assistant",
                content: data.assistantMessage || "",
                thinking: data.thinking || undefined,
                thinkingDurationSeconds: data.thinkingDurationSeconds || undefined,
                toolCalls: data.toolCalls || undefined,
              });
            }

            return {
              ...t,
              messages: updatedMessages,
              contextMessages: data.contextMessages || t.contextMessages,
              consoleEvents: [...(t.consoleEvents || []), ...(data.turnEvents || [])],
              governorState: data.governorState || t.governorState,
              loading: false,
            };
          })
        );
      } catch (error_: unknown) {
        if (error_ instanceof Error && error_.name === "AbortError") return;

        const errorMessage = error_ instanceof Error ? error_.message : String(error_);
        const errorStack = error_ instanceof Error ? error_.stack : undefined;

        const errorEvent: ConsoleEvent = {
          id: `err-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          type: "error",
          badge: "ERROR",
          badgeVariant: "destructive",
          summary: `Turn failed: ${errorMessage}`,
          details: { error: errorMessage, stack: errorStack },
        };

        setTabs((previous) =>
          previous.map((t) =>
            t.id === currentTabId
              ? {
                  ...t,
                  messages: [
                    ...t.messages,
                    {
                      id: String(Date.now() + 1),
                      role: "assistant",
                      content: `Error: ${errorMessage}`,
                    },
                  ],
                  consoleEvents: [...(t.consoleEvents || []), errorEvent],
                  loading: false,
                }
              : t
          )
        );
      } finally {
        abortControllersReference.current.delete(currentTabId);
      }
    },
    [
      activeTab.id,
      activeTab.threadId,
      activeTab.enabledTools,
      activeTab.selectedModel,
      activeTab.thinkingLevel,
      activeTab.executionMode,
      activeTab.messages,
      activeProject,
    ]
  );

  const handleClearConsole = useCallback(
    (targetTabId?: string) => {
      const id = targetTabId || activeTabId;
      setTabs((previous) => previous.map((t) => (t.id === id ? { ...t, consoleEvents: [] } : t)));
    },
    [activeTabId]
  );

  const handleToggleContext = useCallback(
    (targetTabId?: string) => {
      const id = targetTabId || activeTabId;
      setTabs((previous) =>
        previous.map((t) => (t.id === id ? { ...t, showContext: !t.showContext } : t))
      );
    },
    [activeTabId]
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
  };
}
