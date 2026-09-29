import { nanoid } from "nanoid";
import type { TurnEventSink } from "../turn/events";
import type { UserPromptValue } from "../../types";
import type { AskUser } from "./types";

export class PromptBroker {
  private pending = new Map<string, (value: UserPromptValue) => void>();

  createAskUser(sink: TurnEventSink, signal: AbortSignal): AskUser {
    return (prompt, toolCallId) =>
      new Promise<UserPromptValue>((resolve, reject) => {
        if (signal.aborted) {
          reject(new Error("Generation stopped by user"));
          return;
        }
        const promptId = `prompt_${nanoid()}`;
        const onAbort = () => {
          this.pending.delete(promptId);
          reject(new Error("Generation stopped by user"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        this.pending.set(promptId, (value) => {
          signal.removeEventListener("abort", onAbort);
          this.pending.delete(promptId);
          sink.emit({ type: "prompt_answered", promptId, value });
          resolve(value);
        });
        sink.emit({ type: "prompt_requested", promptId, toolCallId, prompt });
      });
  }

  answer(promptId: string, value: UserPromptValue) {
    const answer = this.pending.get(promptId);
    if (!answer) throw new Error(`No pending prompt ${promptId}`);
    answer(value);
  }
}
