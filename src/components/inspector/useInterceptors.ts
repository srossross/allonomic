import { useEffect, useState } from "react";
import { fetchInterceptorsApi } from "@/agent/api";
import type { InterceptorInfo } from "@/core/graph/types";

export function useInterceptors(
  workspacePath: string | undefined,
  sessionId: string | undefined,
  refreshKey: string
): { interceptors: InterceptorInfo[]; error?: string } {
  const [interceptors, setInterceptors] = useState<InterceptorInfo[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!sessionId) return;
    let isCurrent = true;
    const load = async () => {
      try {
        const list = await fetchInterceptorsApi(workspacePath, sessionId);
        if (!isCurrent) return;
        setInterceptors(list);
        setError(undefined);
      } catch (loadError) {
        if (isCurrent) setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    };
    void load();
    return () => {
      isCurrent = false;
    };
  }, [workspacePath, sessionId, refreshKey]);

  return { interceptors, error };
}
