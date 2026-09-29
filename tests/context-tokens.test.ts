import { describe, it, expect } from "bun:test";
import { MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { createCompiledWorkflow } from "../src/core/graph/workflow";
import { createTurnEventLog } from "../src/core/turn/eventLog";
import { foldTurnEvents } from "../src/core/turn/transcript";
import { recordingContext } from "./helpers/turnContext";

describe("context tokens", () => {
  it("model_step carries input_tokens from usage_metadata", async () => {
    const model = {
      invoke: async () =>
        new AIMessage({
          content: "hi",
          usage_metadata: { input_tokens: 1234, output_tokens: 5, total_tokens: 1239 },
        }),
    };
    const compiled = createCompiledWorkflow(model, new ToolNode([]), new MemorySaver(), [], "sys");
    const recorded = recordingContext("t");
    await compiled.invoke(
      { messages: [new HumanMessage("hello")] },
      { configurable: { thread_id: "t", context: recorded.context } }
    );
    const step = recorded.events.find((e) => e.type === "model_step");
    expect(step?.type === "model_step" && step.inputTokens).toBe(1234);
  });

  it("transcript tracks what the turn is waiting on until it ends", () => {
    const { sink, events } = createTurnEventLog(1, []);
    sink.emit({ type: "waiting", on: "Worker model" });
    sink.emit({ type: "waiting", on: "ToolTeacher · pre_tool.md" });
    expect(foldTurnEvents(events).waitingOn).toBe("ToolTeacher · pre_tool.md");
    sink.emit({ type: "turn_completed", retries: 0, finalResponse: "" });
    expect(foldTurnEvents(events).waitingOn).toBeUndefined();
  });

  it("transcript keeps the latest reported count", () => {
    const { sink, events } = createTurnEventLog(1, []);
    const step = { content: "", toolCalls: [], durationMs: 1 };
    sink.emit({ type: "model_step", stepId: "s1", inputTokens: 100, ...step });
    sink.emit({ type: "model_step", stepId: "s2", inputTokens: 250, ...step });
    sink.emit({ type: "model_step", stepId: "s3", ...step });
    expect(foldTurnEvents(events).contextTokens).toBe(250);
  });

  it("is undefined before any reported count", () => {
    const { sink, events } = createTurnEventLog(1, []);
    sink.emit({ type: "model_step", stepId: "s1", content: "", toolCalls: [], durationMs: 1 });
    expect(foldTurnEvents(events).contextTokens).toBeUndefined();
  });
});
