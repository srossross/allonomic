import { useCallback } from "react";
import {
  type TabData,
  type ThinkingLevel,
  type ExecutionMode,
  AVAILABLE_MODES,
  INITIAL_TOOLS,
  DEFAULT_EXECUTION_MODE,
  DEFAULT_GOVERNOR_MODE,
  GOVERNOR_MODES,
} from "@/types";
import type { InterceptorSettings, SettingsPatch } from "@/core/config/settings";

export function useTabSettingsHandlers(
  activeTab: TabData,
  persistTabSettings: (tabId: string, patch: SettingsPatch) => void
) {
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
    handleSelectModel,
    handleSelectThinkingLevel,
    handleSelectExecutionMode,
    handleCycleExecutionMode,
    handleToggleHasNetworkAccess,
    handleToggleTeacher,
    handleSetInterceptorSettings,
    handleCycleGovernorMode,
    handleToggleTool,
    handleSetAllTools,
  };
}
