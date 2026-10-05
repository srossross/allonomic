import { describe, it, expect } from "bun:test";
import { MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { createCompiledWorkflow } from "../src/core/graph/workflow";
import { createTurnEventLog } from "../src/core/turn/eventLog";
import { foldTurnEvents } from "../src/core/turn/transcript";
import type { TurnSegment } from "../src/core/turn/events";
import { emitModelUsage, usageCost } from "../src/core/turn/usage";
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
    const compiled = createCompiledWorkflow(
      model,
      new ToolNode([]),
      new MemorySaver(),
      [],
      "sys",
      "worker-model"
    );
    const recorded = recordingContext("t");
    await compiled.invoke(
      { messages: [new HumanMessage("hello")] },
      { configurable: { thread_id: "t", context: recorded.context } }
    );
    const step = recorded.events.find((e) => e.type === "model_step");
    expect(step?.type === "model_step" && step.inputTokens).toBe(1234);
    const usage = recorded.events.find((e) => e.type === "model_usage");
    expect(usage).toMatchObject({
      agent: "worker",
      model: "worker-model",
      inputTokens: 1234,
      outputTokens: 5,
    });
  });

  it("transcript sums token usage per agent and model", () => {
    const { sink, events } = createTurnEventLog(1, []);
    const usage = (agent: string, model: string, inputTokens: number, outputTokens: number) =>
      sink.emit({ type: "model_usage", agent, model, inputTokens, outputTokens });
    usage("worker", "a", 10, 1);
    usage("interceptor/governor", "a", 5, 2);
    usage("worker", "a", 300_000, 3);
    usage("worker", "b", 7, 7);
    expect(foldTurnEvents(events).tokenUsage).toMatchObject([
      { agent: "worker", model: "a", inputTokens: 300_010, outputTokens: 4 },
      { agent: "interceptor/governor", model: "a", inputTokens: 5, outputTokens: 2 },
      { agent: "worker", model: "b", inputTokens: 7, outputTokens: 7 },
    ]);
  });

  it("prices long prompts at the long-context rate", () => {
    const { sink, events } = createTurnEventLog(1, []);
    sink.emit({ type: "model_usage", model: "m", inputTokens: 100_000, outputTokens: 1000 });
    sink.emit({ type: "model_usage", model: "m", inputTokens: 300_000, outputTokens: 2000 });
    const [row] = foldTurnEvents(events).tokenUsage;
    const cost = usageCost(row!, { input: 2, output: 12, longInput: 4, longOutput: 18 });
    expect(cost.input).toBeCloseTo(0.2 + 1.2);
    expect(cost.output).toBeCloseTo(0.012 + 0.036);
  });

  it("counts thinking tokens as output", async () => {
    const recorded = recordingContext("t");
    emitModelUsage(
      recorded.context.events,
      "worker",
      "m",
      new AIMessage({
        content: "",
        usage_metadata: { input_tokens: 100, output_tokens: 5, total_tokens: 150 },
      })
    );
    expect(recorded.events.find((e) => e.type === "model_usage")).toMatchObject({
      outputTokens: 50,
    });
  });

  it("collapsed scopes keep their usage events on disk", () => {
    const segments: TurnSegment[] = [];
    const { sink } = createTurnEventLog(1, [], (segment) => {
      segments.push(segment);
    });
    const scope = sink.scope("toolteacher", { phase: "pre_tool" });
    scope.emit({
      type: "model_usage",
      agent: "interceptor/toolteacher",
      model: "m",
      inputTokens: 100,
      outputTokens: 1,
    });
    scope.close({ collapse: true });
    const persisted = segments.flatMap((segment) => segment.events);
    expect(persisted.map((event) => event.type)).toEqual(["model_usage", "interceptor_passed"]);
    expect(foldTurnEvents(persisted).tokenUsage).toMatchObject([
      { agent: "interceptor/toolteacher", model: "m", inputTokens: 100, outputTokens: 1 },
    ]);
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
