import { describe, it, expect } from "bun:test";
import { MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { TurnControl } from "../src/core/graph/turnControl";
import { createCompiledWorkflow } from "../src/core/graph/workflow";
import type { AgentInterceptor } from "../src/core/graph/types";
import type { TurnEvent } from "../src/core/turn/events";
import { foldTurnEvents } from "../src/core/turn/transcript";
import { FakeChatModel, toolCall, type ScriptedTurn } from "./helpers/fakeChatModel";
import { createFakeTools } from "./helpers/fakeTools";
import { recordingContext } from "./helpers/turnContext";

describe("TurnControl", () => {
  it("drains in FIFO order and skips removed prompts", () => {
    const control = new TurnControl();
    control.enqueue({ id: "a", text: "first" });
    control.enqueue({ id: "b", text: "second" });
    control.enqueue({ id: "c", text: "third" });
    expect(control.remove("b")).toBe(true);
    expect(control.remove("missing")).toBe(false);
    expect(control.drain().map((p) => p.id)).toEqual(["a", "c"]);
    expect(control.drain()).toEqual([]);
  });

  it("waits while paused until resumed", async () => {
    const control = new TurnControl();
    control.pause();
    const state = { isDone: false };
    const waiting = (async () => {
      await control.waitWhilePaused();
      state.isDone = true;
    })();
    await Promise.resolve();
    expect(state.isDone).toBe(false);
    control.resume();
    await waiting;
    expect(state.isDone).toBe(true);
  });

  it("rejects the wait when aborted", async () => {
    const control = new TurnControl();
    const controller = new AbortController();
    control.pause();
    const waiting = control.waitWhilePaused(controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow("Generation stopped by user");
  });
});

function build(script: ScriptedTurn[], interceptors: AgentInterceptor[] = []) {
  const model = new FakeChatModel(script);
  const { tools } = createFakeTools("restricted");
  const compiled = createCompiledWorkflow(
    model,
    new ToolNode(tools),
    new MemorySaver(),
    interceptors,
    "system",
    "test-model"
  );
  const control = new TurnControl();
  const recorded = recordingContext();
  const controller = new AbortController();
  const context = { ...recorded.context, control };
  const invoke = (text: string) =>
    compiled.invoke(
      { messages: [new HumanMessage(text)] },
      { configurable: { thread_id: "t1", context }, recursionLimit: 30, signal: controller.signal }
    );
  return { model, control, events: recorded.events, invoke, controller };
}

async function untilPaused(events: TurnEvent[]) {
  while (events.every((e) => e.type !== "paused")) await new Promise((r) => setTimeout(r, 1));
}

const LIST = { toolCalls: [toolCall("run_read_only_command", { command: "ls" }, "c1")] };

function types(messages: BaseMessage[]) {
  return messages.map((m) => m._getType());
}

describe("inbox node", () => {
  it("pauses after a tool step and calls the model only after resume", async () => {
    const { model, control, events, invoke } = build([LIST, "done"]);
    control.pause();
    const running = invoke("list");
    await untilPaused(events);
    expect(model.calls).toHaveLength(1);

    control.resume();
    const result = await running;

    expect(model.calls).toHaveLength(2);
    expect(types(result.messages)).toEqual(["human", "ai", "tool", "ai"]);
    expect(events.map((e) => e.type)).toContain("resumed");
  });

  it("delivers queued prompts after a tool step through the entry interceptors", async () => {
    const seen: string[] = [];
    const recorder: AgentInterceptor = {
      name: "Recorder",
      onUserPrompt: async (conversation) => {
        seen.push(String(conversation.at(-1)?.content));
      },
    };
    const { model, control, events, invoke } = build([LIST, "done"], [recorder]);
    control.enqueue({ id: "q1", text: "also check tests" });
    control.enqueue({ id: "q2", text: "and lint" });

    const result = await invoke("list");

    expect(types(result.messages)).toEqual(["human", "ai", "tool", "human", "human", "ai"]);
    expect(seen).toEqual(["list", "and lint"]);
    expect(types(model.calls[1])).toEqual(["system", "human", "ai", "tool", "human", "human"]);
    const delivered = events.flatMap((e) => (e.type === "prompt_delivered" ? [e.queueId] : []));
    expect(delivered).toEqual(["q1", "q2"]);
    const transcript = foldTurnEvents(events);
    expect(transcript.messages.filter((m) => m.isQueued).map((m) => m.content)).toEqual([
      "also check tests",
      "and lint",
    ]);
  });

  it("does not deliver a removed prompt", async () => {
    const { model, control, invoke } = build([LIST, "done"]);
    control.enqueue({ id: "q1", text: "never mind" });
    control.remove("q1");

    await invoke("list");

    expect(types(model.calls[1])).toEqual(["system", "human", "ai", "tool"]);
  });

  it("stopping while paused aborts the turn", async () => {
    const { control, events, invoke, controller } = build([LIST, "done"]);
    control.pause();
    const running = invoke("list");
    await untilPaused(events);

    controller.abort();

    await expect(running).rejects.toThrow();
  });
});
