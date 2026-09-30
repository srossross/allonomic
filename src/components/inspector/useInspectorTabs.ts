import { useState, useEffect, useCallback } from "react";
import { fetchWorkspaceStateApi, saveInspectorTabsApi } from "@/agent/api";
import { normalizeTabOrder, touchTab, type InspectorTabId } from "./inspectorTabs";
import { withAlert } from "@/lib/alertError";

export function useInspectorTabs(workspacePath?: string) {
  const [order, setOrder] = useState<InspectorTabId[]>(() => normalizeTabOrder([]));

  useEffect(() => {
    if (!workspacePath) return;
    let isCancelled = false;
    async function load(path: string) {
      const { state } = await fetchWorkspaceStateApi(path);
      if (!isCancelled && state?.inspectorTabs) setOrder(normalizeTabOrder(state.inspectorTabs));
    }
    void withAlert("Load inspector tabs", () => load(workspacePath));
    return () => {
      isCancelled = true;
    };
  }, [workspacePath]);

  const select = useCallback(
    (id: InspectorTabId) => {
      const next = touchTab(order, id);
      setOrder(next);
      if (workspacePath)
        void withAlert("Save inspector tabs", () => saveInspectorTabsApi(workspacePath, next));
    },
    [order, workspacePath]
  );

  return { order, activeTab: order[0], select };
}
