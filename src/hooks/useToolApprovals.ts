import { useCallback } from "react";
import type { TabData, Project, ConsoleEvent } from "@/types";
import { applyWriteApi } from "@/agent/api";

interface UseToolApprovalsParams {
  activeProject: Project;
  activeTabId: string;
  setTabs: React.Dispatch<React.SetStateAction<TabData[]>>;
}

export function useToolApprovals({ activeProject, activeTabId, setTabs }: UseToolApprovalsParams) {
  const handleApproveTool = useCallback(
    async (messageId: string, toolId: string, args?: Record<string, unknown>) => {
      if (!args) return;
      const filePath = String(args.filePath || "");
      if (!filePath) return;
      const content = String(args.content || "");

      try {
        await applyWriteApi({
          workspaceDir: activeProject?.path,
          filePath,
          content,
        });

        const approvalEvent: ConsoleEvent = {
          id: `appr-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          type: "action",
          badge: "APPROVED",
          badgeVariant: "emerald",
          summary: `Approved and wrote ${content.length} bytes to ${filePath}`,
          details: { filePath, bytesWritten: content.length },
        };

        setTabs((previous) =>
          previous.map((t) => {
            if (t.id !== activeTabId) return t;
            return {
              ...t,
              messages: t.messages.map((m) => {
                if (m.id !== messageId) return m;
                return {
                  ...m,
                  toolCalls: m.toolCalls?.map((tc, index) => {
                    const matchId = tc.id || `${m.id}-tc-${index}`;
                    const isMatch = matchId === toolId || tc.id === toolId;
                    return isMatch
                      ? {
                          ...tc,
                          status: "approved",
                          result: `Successfully wrote ${content.length} bytes to ${filePath}`,
                        }
                      : tc;
                  }),
                };
              }),
              consoleEvents: [...(t.consoleEvents || []), approvalEvent],
            };
          })
        );
      } catch (error: unknown) {
        console.error("Failed to apply approved write:", error);
      }
    },
    [activeProject, activeTabId, setTabs]
  );

  const handleRejectTool = useCallback(
    (messageId: string, toolId: string) => {
      const rejectEvent: ConsoleEvent = {
        id: `rej-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        type: "warning",
        badge: "REJECTED",
        badgeVariant: "destructive",
        summary: "Write action rejected by user",
      };

      setTabs((previous) =>
        previous.map((t) => {
          if (t.id !== activeTabId) return t;
          return {
            ...t,
            messages: t.messages.map((m) => {
              if (m.id !== messageId) return m;
              return {
                ...m,
                toolCalls: m.toolCalls?.map((tc, index) => {
                  const matchId = tc.id || `${m.id}-tc-${index}`;
                  const isMatch = matchId === toolId || tc.id === toolId;
                  return isMatch
                    ? { ...tc, status: "rejected", result: "Rejected by user" }
                    : tc;
                }),
              };
            }),
            consoleEvents: [...(t.consoleEvents || []), rejectEvent],
          };
        })
      );
    },
    [activeTabId, setTabs]
  );

  return { handleApproveTool, handleRejectTool };
}
