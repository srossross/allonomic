import { useCallback, useRef } from "react";
import type { TabData, Project, UserPromptValue } from "@/types";
import { answerPromptApi } from "@/agent/api";
import { createLogger } from "@/core/log";

const log = createLogger("promptResponses");

interface UsePromptResponsesParams {
  activeProject: Project;
  activeTab: TabData;
}

export function usePromptResponses({ activeProject, activeTab }: UsePromptResponsesParams) {
  const inFlightPromptIds = useRef(new Set<string>());

  const handleRespondToPrompt = useCallback(
    async (promptId: string, value: UserPromptValue) => {
      log.info({ promptId, value }, "respond");
      if (inFlightPromptIds.current.has(promptId)) {
        log.warn({ promptId }, "respond:duplicateIgnored");
        return;
      }
      inFlightPromptIds.current.add(promptId);
      try {
        await answerPromptApi(activeProject?.path, activeTab.id, promptId, value);
      } catch (error) {
        log.error(
          { promptId, error: error instanceof Error ? error.message : String(error) },
          "respond:failed"
        );
        globalThis.alert(
          "Failed to answer prompt: " + (error instanceof Error ? error.message : String(error))
        );
      } finally {
        inFlightPromptIds.current.delete(promptId);
      }
    },
    [activeProject, activeTab.id]
  );

  return { handleRespondToPrompt };
}
