import { useCallback, useRef } from "react";
import {
  type TabData,
  type Project,
  type ConsoleEvent,
  type UserPrompt,
  type UserPromptValue,
  INITIAL_TOOLS,
  DEFAULT_MODEL_ID,
  THINKING_BUDGETS,
} from "@/types";
import { respondToPromptApi } from "@/agent/api";
import { buildHistory } from "@/core/history";
import { createLogger } from "@/core/log";
import { formatClock } from "@/core/turn/consoleProjection";
import type { RunTurn } from "./useTurnDispatch";

const log = createLogger("promptResponses");

interface UsePromptResponsesParams {
  activeProject: Project;
  activeTab: TabData;
  setTabs: React.Dispatch<React.SetStateAction<TabData[]>>;
  runTurn: RunTurn;
}

export function usePromptResponses({
  activeProject,
  activeTab,
  setTabs,
  runTurn,
}: UsePromptResponsesParams) {
  const inFlightToolIds = useRef(new Set<string>());

  const handleRespondToPrompt = useCallback(
    async (messageId: string, toolId: string, prompt: UserPrompt, value: UserPromptValue) => {
      log.info("respond", { messageId, toolId, kind: prompt.kind, value });
      if (inFlightToolIds.current.has(toolId)) {
        log.warn("respond:duplicateIgnored", { toolId });
        return;
      }
      inFlightToolIds.current.add(toolId);

      const tab = activeTab;
      const isRejected = value === false;
      const status = isRejected ? "rejected" : "approved";
      const event: ConsoleEvent = {
        id: `resp-${Date.now()}`,
        timestamp: formatClock(new Date()),
        type: isRejected ? "warning" : "action",
        badge: isRejected ? "REJECTED" : "APPROVED",
        badgeVariant: isRejected ? "destructive" : "emerald",
        summary: `${isRejected ? "Rejected" : "Approved"}: ${prompt.label}`,
        details: { toolId, kind: prompt.kind, value },
      };

      setTabs((previous) =>
        previous.map((t) => {
          if (t.id !== tab.id) return t;
          return {
            ...t,
            loading: true,
            messages: t.messages.map((m) =>
              m.id === messageId
                ? {
                    ...m,
                    toolCalls: m.toolCalls?.map((tc) =>
                      tc.id === toolId ? { ...tc, status } : tc
                    ),
                  }
                : m
            ),
            consoleEvents: [...(t.consoleEvents || []), event],
          };
        })
      );

      try {
        await runTurn(tab.id, (onEvent) =>
          respondToPromptApi({
            threadId: tab.threadId,
            sessionId: tab.id,
            workspaceDir: activeProject?.path,
            toolId,
            value,
            history: buildHistory(tab.messages),
            onEvent,
            config: {
              executionMode: tab.executionMode || "manual",
              enabledTools: tab.enabledTools || INITIAL_TOOLS,
              modelName: tab.selectedModel || DEFAULT_MODEL_ID,
              thinkingBudget: THINKING_BUDGETS[tab.thinkingLevel || "Low"],
            },
          })
        );
      } finally {
        inFlightToolIds.current.delete(toolId);
      }
    },
    [activeProject, activeTab, setTabs, runTurn]
  );

  return { handleRespondToPrompt };
}
