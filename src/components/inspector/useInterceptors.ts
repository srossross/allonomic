import { useEffect, useState } from "react";
import { fetchInterceptorsApi } from "@/agent/api";
import type { InterceptorInfo } from "@/core/graph/types";

export function useInterceptors(
  workspacePath: string | undefined,
  sessionId: string | undefined,
  refreshKey: string
): InterceptorInfo[] {
  const [interceptors, setInterceptors] = useState<InterceptorInfo[]>([]);

  useEffect(() => {
    if (!sessionId) return;
    let isCurrent = true;
    const load = async () => {
      try {
        const list = await fetchInterceptorsApi(workspacePath, sessionId);
        if (isCurrent) setInterceptors(list);
      } catch (error: unknown) {
        console.error("Failed to load interceptors:", error);
      }
    };
    void load();
    return () => {
      isCurrent = false;
    };
  }, [workspacePath, sessionId, refreshKey]);

  return interceptors;
}
