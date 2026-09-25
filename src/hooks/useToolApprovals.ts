import { useCallback } from "react";
import type { TabData, Project, ConsoleEvent, Message } from "@/types";
import { applyWriteApi, resumeAgentPromptApi, executeCommandApi } from "@/agent/api";

interface UseToolApprovalsParams {
  activeProject: Project;
  activeTabId: string;
  setTabs: React.Dispatch<React.SetStateAction<TabData[]>>;
}

export function useToolApprovals({ activeProject, activeTabId, setTabs }: UseToolApprovalsParams) {
  const handleApproveTool = useCallback(
    async (messageId: string, toolId: string, toolName: string, args?: Record<string, unknown>) => {
      if (!args) return;
      
      let resultString = "User approved";
      let approvalEvent: ConsoleEvent | null = null;

      try {
        if (toolName === "write_file") {
          const filePath = String(args.filePath || "");
          if (!filePath) return;
          const content = String(args.content || "");
          
          await applyWriteApi({
            workspaceDir: activeProject?.path,
            filePath,
            content,
          });

          resultString = `Successfully wrote ${content.length} bytes to ${filePath}`;
          approvalEvent = {
            id: `appr-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
            type: "action",
            badge: "APPROVED",
            badgeVariant: "emerald",
            summary: `Approved and wrote ${content.length} bytes to ${filePath}`,
            details: { filePath, bytesWritten: content.length },
          };
        } else if (toolName === "run_mutating_command") {
          const command = String(args.command || "");
          if (!command) return;

          try {
            const res = await executeCommandApi({
              workspaceDir: activeProject?.path,
              command
            });

            resultString = (res.stdout || "") + (res.stderr ? `\n[STDERR]:\n${res.stderr}` : "");
            if (!resultString) resultString = "Command executed successfully with no output.";

            approvalEvent = {
              id: `appr-${Date.now()}`,
              timestamp: new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
              type: "action",
              badge: "APPROVED",
              badgeVariant: "emerald",
              summary: `Approved and ran command: ${command}`,
              details: { command, stdout: res.stdout, stderr: res.stderr },
            };
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            resultString = `[STDERR]:\nCommand failed to execute or API error: ${errorMessage}`;
            approvalEvent = {
              id: `appr-${Date.now()}`,
              timestamp: new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
              type: "action",
              badge: "FAILED",
              badgeVariant: "rose",
              summary: `Execution failed: ${command}`,
              details: { command, error: errorMessage },
            };
          }
        } else {
          return; // Unknown tool
        }
        
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
              consoleEvents: approvalEvent ? [...(t.consoleEvents || []), approvalEvent] : t.consoleEvents,
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
