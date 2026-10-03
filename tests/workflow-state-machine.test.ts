import { describe, it, expect } from "bun:test";
import { GraphRecursionError, MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { createCompiledWorkflow, type CompiledWorkflow } from "../src/core/graph/workflow";
import { closeUnansweredToolCalls, rehydrateHistory } from "../src/core/graph/threadState";
import type { AgentInterceptor } from "../src/core/graph/types";
import type { TurnEvent } from "../src/core/turn/events";
import type { ExecutionMode, UserPrompt, UserPromptValue } from "../src/types";
import { FakeChatModel, toolCall, type ScriptedTurn } from "./helpers/fakeChatModel";
import { createFakeTools } from "./helpers/fakeTools";
import { recordingContext } from "./helpers/turnContext";

const THREAD = "t1";

const asked: Array<{ prompt: UserPrompt; toolCallId?: string }> = [];
const user: { answer: UserPromptValue } = { answer: true };

function build(
  script: ScriptedTurn[],
  options: { mode?: ExecutionMode; interceptors?: AgentInterceptor[] } = {}
) {
  const model = new FakeChatModel(script);
  const { tools, log } = createFakeTools(options.mode ?? "restricted");
  const compiled = createCompiledWorkflow(
    model,
    new ToolNode(tools),
    new MemorySaver(),
    options.interceptors ?? [],
    "system"
  );
  return { compiled, model, log };
}

const recorded = recordingContext(THREAD, 1, async (prompt, toolCallId) => {
  asked.push({ prompt, toolCallId });
  return user.answer;
});

function config() {
  return { configurable: { thread_id: THREAD, context: recorded.context } };
}

async function invoke(compiled: CompiledWorkflow, input: { messages: BaseMessage[] } | null) {
  recorded.events.length = 0;
  asked.length = 0;
  return await compiled.invoke(input, { ...config(), recursionLimit: 20 });
}

function eventTypes(events: TurnEvent[] = recorded.events) {
  return events.map((e) => e.type);
}

function types(messages: BaseMessage[]) {
  return messages.map((m) => m._getType());
}

describe("workflow state machine", () => {
  it("plain answer: START -> entry -> agent -> exit -> END", async () => {
    const { compiled, model } = build(["hello back"]);
    const result = await invoke(compiled, { messages: [new HumanMessage("hi")] });
    expect(types(result.messages)).toEqual(["human", "ai"]);
    expect(model.calls.length).toBe(1);
    const state = await compiled.getState(config());
    expect(state.next).toEqual([]);
    expect(eventTypes()).toEqual(["waiting", "model_step"]);
    const step = recorded.events[1];
    expect(step.type === "model_step" && step.content).toBe("hello back");
    expect(step.type === "model_step" && step.stepId).toBe(String(result.messages[1].id));
  });

  it("tool round trip: agent -> tools -> agent -> END", async () => {
    const { compiled, log } = build([
      { toolCalls: [toolCall("run_read_only_command", { command: "ls" }, "c1")] },
      "done",
    ]);
    const result = await invoke(compiled, { messages: [new HumanMessage("list")] });
    expect(types(result.messages)).toEqual(["human", "ai", "tool", "ai"]);
    expect(log).toEqual(["read:ls"]);
    expect(eventTypes()).toEqual([
      "waiting",
      "model_step",
      "waiting",
      "tool_result",
      "waiting",
      "model_step",
    ]);
    const toolResult = recorded.events[3];
    expect(
      toolResult.type === "tool_result" && [toolResult.toolCallId, toolResult.content]
    ).toEqual(["c1", "ran ls"]);
  });

  it("askUser: an accepted prompt runs the tool and the agent continues in the same invoke", async () => {
    user.answer = true;
    const { compiled, log } = build([
      { toolCalls: [toolCall("run_mutating_command", { command: "rm x" }, "c1")] },
      "done",
    ]);
    const result = await invoke(compiled, { messages: [new HumanMessage("delete")] });
    expect(types(result.messages)).toEqual(["human", "ai", "tool", "ai"]);
    expect(log).toEqual(["mutate:rm x"]);
    expect(asked).toEqual([{ prompt: { kind: "confirm", label: "rm x" }, toolCallId: "c1" }]);
  });

  it("askUser: a declined prompt rejects and the agent continues without the tool running", async () => {
    user.answer = false;
    const { compiled, model, log } = build([
      { toolCalls: [toolCall("run_mutating_command", { command: "rm x" }, "c1")] },
      "ok, skipped",
    ]);
    const result = await invoke(compiled, { messages: [new HumanMessage("delete")] });
    expect(types(result.messages)).toEqual(["human", "ai", "tool", "ai"]);
    expect(log).toEqual([]);
    expect(String(model.calls.at(-1)!.at(-1)?.content)).toContain("[USER_REJECTED]");
    user.answer = true;
  });

  it("write mode: mutating tool runs without stopping", async () => {
    const { compiled, log } = build(
      [{ toolCalls: [toolCall("run_mutating_command", { command: "rm x" }, "c1")] }, "done"],
      { mode: "write" }
    );
    const result = await invoke(compiled, { messages: [new HumanMessage("delete")] });
    expect(types(result.messages)).toEqual(["human", "ai", "tool", "ai"]);
    expect(log).toEqual(["mutate:rm x"]);
    expect(asked).toEqual([]);
  });

  it("resume on an empty thread throws EmptyInputError", async () => {
    const { compiled } = build(["never"]);
    await expect(invoke(compiled, null)).rejects.toThrow(/no input writes/);
  });

  it("rehydrateHistory is a no-op when the thread already has state", async () => {
    const { compiled } = build(["a", "b"]);
    await invoke(compiled, { messages: [new HumanMessage("one")] });
    await rehydrateHistory(compiled, THREAD, [{ role: "user", content: "ignored" }]);
    const state = await compiled.getState(config());
    expect(state.values.messages.length).toBe(2);
  });

  it("exit interceptor rejection loops back to the agent once", async () => {
    let verdicts = 0;
    const strict: AgentInterceptor = {
      name: "Strict",
      onAgentFinish: async () => {
        verdicts++;
        return verdicts === 1
          ? { allowFinish: false, feedback: "try again" }
          : { allowFinish: true };
      },
    };
    const { compiled, model } = build(["first", "second"], { interceptors: [strict] });
    const result = await invoke(compiled, { messages: [new HumanMessage("go")] });
    expect(types(result.messages)).toEqual(["human", "ai", "human", "ai"]);
    expect(String(result.messages[2].content)).toContain("[Strict Feedback]: try again");
    expect(model.calls.length).toBe(2);
    expect(verdicts).toBe(2);
    expect(eventTypes()).toEqual([
      "waiting",
      "model_step",
      "exit_retry",
      "waiting",
      "model_step",
      "interceptor_passed",
    ]);
  });

  it("onPresent runs after all exit verdicts allow, never on a rejected finish", async () => {
    const order: string[] = [];
    let verdicts = 0;
    const presenter: AgentInterceptor = {
      name: "Presenter",
      onPresent: async () => {
        order.push("present");
      },
    };
    const strict: AgentInterceptor = {
      name: "Strict",
      onAgentFinish: async () => {
        order.push("finish");
        return ++verdicts === 1 ? { allowFinish: false, feedback: "again" } : { allowFinish: true };
      },
    };
    const { compiled } = build(["first", "second"], { interceptors: [presenter, strict] });
    await invoke(compiled, { messages: [new HumanMessage("go")] });
    expect(order).toEqual(["finish", "finish", "present"]);
  });

  it("entry interceptor runs once for a human prompt that includes an approval", async () => {
    const prompts: string[] = [];
    const entry: AgentInterceptor = {
      name: "Entry",
      onUserPrompt: async (conversation) => {
        expect(conversation[0]?._getType()).toBe("system");
        prompts.push(String(conversation.at(-1)?.content));
      },
    };
    const { compiled } = build(
      [{ toolCalls: [toolCall("run_mutating_command", { command: "rm x" }, "c1")] }, "done"],
      { interceptors: [entry] }
    );
    await invoke(compiled, { messages: [new HumanMessage("delete")] });
    expect(prompts).toEqual(["delete"]);
  });

  it("agent that keeps calling tools hits the recursion limit", async () => {
    const loop: ScriptedTurn[] = Array.from({ length: 30 }, (_, i) => ({
      toolCalls: [toolCall("run_read_only_command", { command: `ls ${i}` }, `c${i}`)],
    }));
    const { compiled } = build(loop);
    await expect(
      compiled.invoke({ messages: [new HumanMessage("loop")] }, { ...config(), recursionLimit: 10 })
    ).rejects.toThrow(/Recursion limit/);
  });

  it("recursion limit leaves no unanswered tool calls after closing", async () => {
    const loop: ScriptedTurn[] = Array.from({ length: 5 }, (_, i) => ({
      toolCalls: [toolCall("run_read_only_command", { command: `ls ${i}` }, `c${i}`)],
    }));
    const { compiled } = build(loop);
    await expect(
      compiled.invoke({ messages: [new HumanMessage("loop")] }, { ...config(), recursionLimit: 5 })
    ).rejects.toThrow(GraphRecursionError);

    const closed = await closeUnansweredToolCalls(compiled, THREAD, "Not run: step limit reached");
    expect(closed).toHaveLength(1);
    const state = await compiled.getState(config());
    const messages: BaseMessage[] = state.values.messages;
    const callIds = messages.flatMap((m) => (m instanceof AIMessage ? (m.tool_calls ?? []) : []));
    const answered = messages.filter((m) => m instanceof ToolMessage);
    expect(answered.length).toBe(callIds.length);
    expect(String(answered.at(-1)?.content)).toBe("Not run: step limit reached");
    expect(await closeUnansweredToolCalls(compiled, THREAD, "x")).toEqual([]);
  });
});
