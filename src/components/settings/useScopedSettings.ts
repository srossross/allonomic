import { useCallback, useEffect, useState } from "react";
import { fetchScopedSettingsApi, saveSettingsLayerApi } from "@/agent/api";
import type { SettingsLayer } from "@/core/config/settings";
import type { ScopedSettings, SettingsScope } from "@/core/config/scopedSettings";
import { alertError, withAlert } from "@/lib/alertError";

export function useScopedSettings(
  workspacePath: string | undefined,
  sessionId: string | undefined,
  onSaved: () => Promise<void>
) {
  const [scoped, setScoped] = useState<ScopedSettings>();

  useEffect(() => {
    if (!workspacePath) return;
    let isCurrent = true;
    void withAlert("Load settings", async () => {
      const next = await fetchScopedSettingsApi(workspacePath, sessionId);
      if (isCurrent) setScoped(next);
    });
    return () => {
      isCurrent = false;
    };
  }, [workspacePath, sessionId]);

  const save = useCallback(
    async (scope: SettingsScope, layer: SettingsLayer) => {
      if (!workspacePath) return;
      try {
        await saveSettingsLayerApi(workspacePath, sessionId, scope, layer);
        setScoped(await fetchScopedSettingsApi(workspacePath, sessionId));
        await onSaved();
      } catch (error) {
        alertError("Save settings")(error);
      }
    },
    [workspacePath, sessionId, onSaved]
  );

  return { scoped, save };
}
