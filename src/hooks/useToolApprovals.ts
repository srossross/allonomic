import { useCallback } from "react";
import type { TabData, Project, ConsoleEvent, Message } from "@/types";
import { applyWriteApi, resumeAgentPromptApi } from "@/agent/api";

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
      const resultString = `Successfully wrote ${content.length} bytes to ${filePath}`;

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

        // Get the active tab to read threadId
        let threadId = "default";
        setTabs((previous) => {
          const t = previous.find(p => p.id === activeTabId);
          if (t) threadId = t.threadId;
          return previous.map((t) => {
            if (t.id !== activeTabId) return t;
            return {
              ...t,
              loading: true, // Set loading while resuming
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
                          result: resultString,
                        }
                      : tc;
                  }),
                };
              }),
              consoleEvents: [...(t.consoleEvents || []), approvalEvent],
            };
          });
        });

        // Resume the agent
        const data = await resumeAgentPromptApi({
           threadId,
           sessionId: activeTabId,
           workspaceDir: activeProject?.path,
           toolId,
           resultString
        });

        setTabs((previous) =>
          previous.map((t) => {
            if (t.id !== activeTabId) return t;

            const updatedMessages: Message[] = [...t.messages];
            if (data.turnSteps && data.turnSteps.length > 0) {
              for (const [idx, step] of data.turnSteps.entries()) {
                updatedMessages.push({
                  id: String(Date.now() + idx + 1),
                  role: step.role,
                  content: step.content,
                  thinking: step.thinking,
                  thinkingDurationSeconds: step.thinkingDurationSeconds || (idx === 0 ? data.thinkingDurationSeconds : undefined),
                  toolCalls: step.toolCalls,
                });
              }
            } else if (data.assistantMessage || (data.toolCalls && data.toolCalls.length > 0)) {
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
      } catch (error: unknown) {
        console.error("Failed to apply approved write or resume:", error);
        setTabs((previous) => previous.map(t => t.id === activeTabId ? { ...t, loading: false } : t));
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
