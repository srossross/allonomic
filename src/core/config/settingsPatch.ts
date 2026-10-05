import type { InterceptorSettings, Settings, SettingsLayer } from "./settings";

export type SettingsPatch = Partial<
  Omit<Settings, "enabledTools" | "interceptors" | "sandbox" | "shellEnv">
> & {
  tools?: Record<string, boolean>;
  interceptors?: Record<string, InterceptorSettings>;
};

export function patchToLayer(patch: SettingsPatch): SettingsLayer {
  return {
    ...(patch.executionMode && { execution_mode: patch.executionMode }),
    ...(patch.networkAccess !== undefined && { network_access: patch.networkAccess }),
    ...(patch.governorMode && { governor_mode: patch.governorMode }),
    ...(patch.teacherEnabled !== undefined && { teacher: patch.teacherEnabled }),
    ...(patch.uiEnabled !== undefined && { ui: patch.uiEnabled }),
    ...(patch.collapseWorkerText !== undefined && {
      collapse_worker_text: patch.collapseWorkerText,
    }),
    ...(patch.shellTimeoutSeconds !== undefined && {
      shell_timeout_seconds: patch.shellTimeoutSeconds,
    }),
    ...(patch.model && { model: patch.model }),
    ...(patch.thinkingLevel && { thinking_level: patch.thinkingLevel }),
    ...(patch.tools && { tools: patch.tools }),
    ...(patch.interceptors && {
      interceptors: Object.fromEntries(
        Object.entries(patch.interceptors).map(([name, { model, thinkingLevel }]) => [
          name,
          { model, thinking_level: thinkingLevel },
        ])
      ),
    }),
  };
}
