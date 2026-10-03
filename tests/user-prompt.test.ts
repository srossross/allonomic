import { describe, it, expect } from "bun:test";
import { HumanMessage } from "@langchain/core/messages";
import { createTurnEventLog } from "../src/core/turn/eventLog";
import { replayWorkerMessages } from "../src/core/turn/ops";
import { isUserPrompt, lastUserPrompt, userPromptMessage } from "../src/core/graph/userPrompt";

describe("user prompt tagging", () => {
  it("survives op-log replay; briefs do not become user prompts", () => {
    const { sink, events } = createTurnEventLog(1, []);
    sink.emit({ type: "turn_started", threadId: "t", prompt: "apply all fixes" });
    sink.emit({ type: "governor_brief", interceptor: "Governor", text: "Goal", doneWhen: [] });
    sink.emit({ type: "prompt_delivered", queueId: "q1", text: "and lint" });

    const messages = replayWorkerMessages(events);
    expect(messages.map((m) => isUserPrompt(m))).toEqual([true, false, true]);
    expect(messages[1].content).toBe("[Governor]: Goal");
  });

  it("lastUserPrompt skips untagged human messages", () => {
    expect(
      lastUserPrompt([
        userPromptMessage("first"),
        userPromptMessage("second", { queueId: "q1" }),
        new HumanMessage("retry feedback"),
      ])
    ).toBe("second");
  });
});
