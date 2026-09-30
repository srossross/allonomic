import type { Message, UserPrompt } from "@/types";

export interface PendingPrompt {
  toolId: string;
  prompt: UserPrompt;
  promptId: string;
}

export function findPendingPrompt(messages: Message[]): PendingPrompt | null {
  for (let mIndex = messages.length - 1; mIndex >= 0; mIndex--) {
    const msg = messages[mIndex];
    if (msg.role !== "assistant" || !msg.toolCalls) continue;
    for (let tcIndex = msg.toolCalls.length - 1; tcIndex >= 0; tcIndex--) {
      const tc = msg.toolCalls[tcIndex];
      if (tc.status !== "pending" || !tc.prompt || !tc.promptId) continue;
      return {
        toolId: tc.id || `${msg.id}-tc-${tcIndex}`,
        prompt: tc.prompt,
        promptId: tc.promptId,
      };
    }
  }
  return null;
}
