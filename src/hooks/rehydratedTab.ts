import type { RehydratedSession, TabData } from "@/types";

export function rehydratedToTab(
  rehydrated: RehydratedSession
): Pick<TabData, "messages" | "governorState"> & Partial<TabData> {
  return {
    messages: rehydrated.messages,
    contextMessages: rehydrated.contextMessages,
    consoleEvents: rehydrated.consoleEvents,
    agentFiles: rehydrated.agentFiles,
    governorState: rehydrated.governorState,
    loadErrors: rehydrated.loadErrors,
    contextTokens: rehydrated.contextTokens,
    tokenUsage: rehydrated.tokenUsage,
    profile: rehydrated.profile,
    turnTree: rehydrated.turnTree,
    waitingOn: undefined,
    pendingPrompt: undefined,
  };
}
