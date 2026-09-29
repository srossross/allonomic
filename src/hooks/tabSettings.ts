import type { Settings } from "@/core/config/settings";
import type { TabData } from "@/types";

export function settingsToTab(settings: Settings): Partial<TabData> {
  return {
    selectedModel: settings.model,
    thinkingLevel: settings.thinkingLevel,
    executionMode: settings.executionMode,
    hasNetworkAccess: settings.networkAccess,
    governorMode: settings.governorMode,
    teacherEnabled: settings.teacherEnabled,
    enabledTools: settings.enabledTools,
    interceptorSettings: settings.interceptors,
  };
}
