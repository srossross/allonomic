import { EXECUTION_MODE_LEVELS, GOVERNOR_MODES } from "../../types/chat";
import type { Settings, SettingsLayer } from "./settings";

export function tightenLayer(settings: Settings, layer: SettingsLayer): Settings {
  const mode = layer.execution_mode;
  const governor = layer.governor_mode;
  const disabled = new Set(
    Object.entries(layer.tools ?? {})
      .filter(([, isEnabled]) => !isEnabled)
      .map(([name]) => name)
  );
  return {
    ...settings,
    executionMode:
      mode && EXECUTION_MODE_LEVELS[mode] < EXECUTION_MODE_LEVELS[settings.executionMode]
        ? mode
        : settings.executionMode,
    networkAccess: layer.network_access !== false && settings.networkAccess,
    governorMode:
      governor && GOVERNOR_MODES.indexOf(governor) > GOVERNOR_MODES.indexOf(settings.governorMode)
        ? governor
        : settings.governorMode,
    teacherEnabled: layer.teacher === true || settings.teacherEnabled,
    enabledTools: settings.enabledTools.filter((name) => !disabled.has(name)),
    sandbox: {
      ...settings.sandbox,
      deny: [...settings.sandbox.deny, ...(layer.sandbox?.deny ?? [])],
    },
  };
}
