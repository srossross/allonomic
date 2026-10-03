import { nanoid } from "nanoid";
import { USER_ACTOR, type TurnEventSink } from "../turn/events";
import type { UserPromptValue } from "../../types";
import type { AskUser } from "./types";
import { StopError } from "./stopError";

export class PromptBroker {
  private pending = new Map<string, (value: UserPromptValue) => void>();

  createAskUser(sink: TurnEventSink, signal: AbortSignal): AskUser {
    return (prompt, toolCallId) =>
      new Promise<UserPromptValue>((resolve, reject) => {
        if (signal.aborted) {
          reject(new StopError());
          return;
        }
        const promptId = `prompt_${nanoid()}`;
        const user = sink.scope(USER_ACTOR);
        const onAbort = () => {
          this.pending.delete(promptId);
          user.close();
          reject(new StopError());
        };
        signal.addEventListener("abort", onAbort, { once: true });
        this.pending.set(promptId, (value) => {
          signal.removeEventListener("abort", onAbort);
          this.pending.delete(promptId);
          user.emit({ type: "prompt_answered", promptId, value });
          user.close();
          resolve(value);
        });
        user.emit({ type: "prompt_requested", promptId, toolCallId, prompt });
      });
  }

  answer(promptId: string, value: UserPromptValue) {
    const answer = this.pending.get(promptId);
    if (!answer) throw new Error(`No pending prompt ${promptId}`);
    answer(value);
  }
}
