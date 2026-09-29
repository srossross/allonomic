import { describe, it, expect } from "bun:test";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { AgentRunner } from "../src/core/graph/runner";
import type { AgentInterceptor } from "../src/core/graph/types";
import { FakeChatModel, toolCall } from "./helpers/fakeChatModel";

const THREAD = "t1";

describe("AgentRunner failures", () => {
  it("a throwing pre-tool interceptor fails the turn and leaves no unanswered tool calls", async () => {
    const failing: AgentInterceptor = {
      name: "Failing",
      onPreToolCall: async () => {
        throw new Error("governor blew up");
      },
    };
    const runner = new AgentRunner({
      runtime: createMemoryRuntime(),
      workspaceDir: "/w",
      sessionId: "s1",
      interceptors: [failing],
      createModel: () =>
        new FakeChatModel([
          { toolCalls: [toolCall("run_read_only_command", { command: "ls" }, "c1")] },
        ]),
    });

    await expect(runner.run("list", THREAD)).rejects.toThrow("governor blew up");

    const state = await runner.compiled.getState({ configurable: { thread_id: THREAD } });
    const messages: BaseMessage[] = state.values.messages;
    const callIds = messages.flatMap((m) =>
      m instanceof AIMessage ? (m.tool_calls ?? []).map((c) => c.id) : []
    );
    const answered = messages
      .filter((m): m is ToolMessage => m instanceof ToolMessage)
      .map((m) => m.tool_call_id);
    expect(callIds).toEqual(["c1"]);
    expect(answered).toEqual(callIds);
  });
});
