import { describe, it, expect } from "bun:test";
import { MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { createCompiledWorkflow } from "../src/core/graph/workflow";
import type { AgentInterceptor } from "../src/core/graph/types";
import { FakeChatModel, toolCall, type ScriptedTurn } from "./helpers/fakeChatModel";
import { createFakeTools } from "./helpers/fakeTools";
import { recordingContext } from "./helpers/turnContext";

const THREAD = "t1";
const declining = recordingContext(THREAD, 1, async () => false).context;
const config = { configurable: { thread_id: THREAD, context: declining } };

function build(script: ScriptedTurn[], interceptors: AgentInterceptor[] = []) {
  const model = new FakeChatModel(script);
  const { tools, log } = createFakeTools("restricted");
  const compiled = createCompiledWorkflow(
    model,
    new ToolNode(tools),
    new MemorySaver(),
    interceptors,
    "system"
  );
  return { compiled, model, log };
}

describe("workflow tool failures", () => {
  it("a declined prompt beside another tool call still lets the other run", async () => {
    const { compiled, model, log } = build([
      {
        toolCalls: [
          toolCall("run_mutating_command", { command: "rm x" }, "c1"),
          toolCall("run_read_only_command", { command: "ls" }, "c2"),
        ],
      },
      "done",
    ]);
    const result = await compiled.invoke({ messages: [new HumanMessage("go")] }, config);
    expect(result.messages.map((m: BaseMessage) => m._getType())).toEqual([
      "human",
      "ai",
      "tool",
      "tool",
      "ai",
    ]);
    expect(log).toEqual(["read:ls"]);
    expect(model.calls.length).toBe(2);
  });
});
