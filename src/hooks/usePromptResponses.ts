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
      log.info("respond", { promptId, value });
      if (inFlightPromptIds.current.has(promptId)) {
        log.warn("respond:duplicateIgnored", { promptId });
        return;
      }
      inFlightPromptIds.current.add(promptId);
      try {
        await answerPromptApi(activeProject?.path, activeTab.id, promptId, value);
      } catch (error) {
        log.error("respond:failed", {
          promptId,
          error: error instanceof Error ? error.message : String(error),
        });
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
