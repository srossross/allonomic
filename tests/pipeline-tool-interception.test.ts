import { describe, it, expect } from "bun:test";
import { MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { createCompiledWorkflow } from "../src/core/graph/workflow";
import type { AgentInterceptor, ToolCall } from "../src/core/graph/types";
import { FakeChatModel, toolCall, type ScriptedTurn } from "./helpers/fakeChatModel";
import { createFakeTools } from "./helpers/fakeTools";
import { recordingContext } from "./helpers/turnContext";

function run(script: ScriptedTurn[], interceptor: AgentInterceptor) {
  const { tools, log } = createFakeTools("write");
  const compiled = createCompiledWorkflow(
    new FakeChatModel(script),
    new ToolNode(tools),
    new MemorySaver(),
    [interceptor],
    "system"
  );
  const { context, events } = recordingContext();
  const result = compiled.invoke(
    { messages: [new HumanMessage("go")] },
    { configurable: { thread_id: "t1", context }, recursionLimit: 20 }
  );
  return { result, log, events };
}

describe("Pre-tool interception in the tools node", () => {
  it("denies with an error ToolMessage and executes only approved calls, in call order", async () => {
    const seen: { call: ToolCall; conversation: BaseMessage[] }[] = [];
    const interceptor: AgentInterceptor = {
      name: "Gate",
      onPreToolCall: async (call, conversation) => {
        seen.push({ call, conversation });
        return call.name === "run_mutating_command"
          ? { approved: false, reason: "no mutations" }
          : { approved: true };
      },
    };
    const { result, log, events } = run(
      [
        {
          toolCalls: [
            toolCall("run_mutating_command", { command: "rm x" }, "c1"),
            toolCall("run_read_only_command", { command: "ls" }, "c2"),
          ],
        },
        "done",
      ],
      interceptor
    );
    const { messages } = await result;

    expect(log).toEqual(["read:ls"]);
    const toolMessages = messages.filter((m): m is ToolMessage => m instanceof ToolMessage);
    expect(toolMessages.map((m) => [m.tool_call_id, m.status])).toEqual([
      ["c1", "error"],
      ["c2", "success"],
    ]);
    expect(String(toolMessages[0].content)).toBe("[INTERCEPTED by Gate]: no mutations");

    expect(seen.map((s) => s.call.id)).toEqual(["c1", "c2"]);
    expect(seen[0].conversation[0]?._getType()).toBe("system");
    expect(seen[0].conversation.at(-1)?._getType()).toBe("ai");

    const results = events.filter((e) => e.type === "tool_result");
    expect(results.map((e) => (e.type === "tool_result" ? e.status : undefined))).toEqual([
      "error",
      "success",
    ]);
  });

  it("bubbles interceptor errors up and fails the turn", async () => {
    const interceptor: AgentInterceptor = {
      name: "Broken",
      onPreToolCall: async () => {
        throw new Error("governor exploded");
      },
    };
    const { result, log } = run(
      [{ toolCalls: [toolCall("run_read_only_command", { command: "ls" }, "c1")] }, "done"],
      interceptor
    );
    await expect(result).rejects.toThrow("governor exploded");
    expect(log).toEqual([]);
  });
});
