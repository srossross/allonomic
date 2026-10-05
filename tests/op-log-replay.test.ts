import { describe, it, expect } from "bun:test";
import { isAIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { AgentRunner } from "../src/core/graph/runner";
import type { AgentInterceptor } from "../src/core/graph/types";
import { messageText } from "../src/core/graph/thinking";
import { isUserPrompt } from "../src/core/graph/userPrompt";
import { replayGovernorState, replaySession } from "../src/core/session/rehydration";
import { replayWorkerMessages } from "../src/core/turn/ops";
import { FakeChatModel, toolCall } from "./helpers/fakeChatModel";
import { scriptedGovernor, stubPromptRuntime } from "./helpers/governorForks";

const SESSION_DIR = "/w/.allonomic/sessions/s1";
const READ = "shell_1_project_read_only";

const teacher: AgentInterceptor = {
  name: "ToolTeacher",
  async onPreToolCall(call) {
    return call.args.command === "rm x"
      ? { approved: false, reason: "not that" }
      : { approved: true };
  },
  async onPostToolCall(call) {
    return call.args.command === "ls" ? "LESSON" : undefined;
  },
};

function view(message: BaseMessage) {
  return {
    type: message._getType(),
    content: messageText(message.content),
    toolCalls: isAIMessage(message)
      ? (message.tool_calls ?? []).map(({ id, name, args }) => ({ id, name, args }))
      : undefined,
    toolCallId: message instanceof ToolMessage ? message.tool_call_id : undefined,
    isUserPrompt: isUserPrompt(message),
  };
}

describe("op-log replay", () => {
  it("rebuilds the live worker conversation and governor state from disk", async () => {
    const runtime = await stubPromptRuntime();
    const { governor } = scriptedGovernor(runtime, [
      {
        name: "push_intent",
        args: {
          id: "i1",
          kind: "request",
          description: "list",
          completed_when: "listed",
          overstep: "deleting",
          specificity: "low",
        },
      },
      { name: "finish" },
      { name: "returnToWorkerWithUnmetIntent", args: { intent_id: "i1", why: "not listed" } },
      { name: "resolve_intent", args: { id: "i1" } },
      { name: "atLeastOneIntentWasSatisfied" },
    ]);
    governor.setHasAssumptions(false);
    const runner = new AgentRunner({
      runtime,
      workspaceDir: "/w",
      sessionId: "s1",
      executionMode: "restricted",
      interceptors: [teacher, governor],
      createModel: () =>
        new FakeChatModel([
          { toolCalls: [toolCall(READ, { command: "rm x" }, "c1")] },
          { toolCalls: [toolCall(READ, { command: "ls" }, "c2")] },
          "first answer",
          "final answer",
        ]),
    });

    const result = await runner.run("list files", "s1");

    const live = result.messages.map((m) => view(m));
    expect(live.map((m) => m.type)).toEqual([
      "human",
      "human",
      "ai",
      "tool",
      "ai",
      "tool",
      "ai",
      "human",
      "ai",
    ]);
    expect(live[3].content).toBe("[INTERCEPTED by ToolTeacher]: not that");
    expect(live[5].content).toEndWith("[ToolTeacher]: LESSON");
    expect(live[7].content).toStartWith("Your output did not satisfy the exit criteria:");

    const replay = await replaySession(runtime.fs, SESSION_DIR);
    expect(replay.loadErrors).toEqual([]);
    expect(replayWorkerMessages(replay.events).map((m) => view(m))).toEqual(live);
    expect(replayGovernorState(replay.events)).toEqual(governor.state);
  });
});
