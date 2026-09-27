import { describe, it, expect } from "bun:test";
import { MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { createCompiledWorkflow, type CompiledWorkflow } from "../src/core/graph/workflow";
import { rehydrateHistory, respondToPromptResult } from "../src/core/graph/threadState";
import type { AgentInterceptor } from "../src/core/graph/types";
import type { TurnEvent } from "../src/core/turn/events";
import { buildHistory } from "../src/core/history";
import type { Message } from "../src/types";
import { FakeChatModel, toolCall, type ScriptedTurn } from "./helpers/fakeChatModel";
import { createFakeTools } from "./helpers/fakeTools";
import { createPendingResult, decodeToolResult } from "../src/core/userPrompt";
import { recordingContext } from "./helpers/turnContext";

const approve = async (name: string, args: Record<string, unknown>) =>
  `approved ${name}: ${JSON.stringify(args)}`;

const THREAD = "t1";

function build(
  script: ScriptedTurn[],
  options: { mode?: "manual" | "accept edits"; interceptors?: AgentInterceptor[] } = {}
) {
  const model = new FakeChatModel(script);
  const { tools, log } = createFakeTools(options.mode ?? "manual");
  const compiled = createCompiledWorkflow(
    model,
    new ToolNode(tools),
    new MemorySaver(),
    options.interceptors ?? [],
    "system"
  );
  return { compiled, model, log };
}

const recorded = recordingContext(THREAD);

function config() {
  return { configurable: { thread_id: THREAD, context: recorded.context } };
}

async function invoke(compiled: CompiledWorkflow, input: { messages: BaseMessage[] } | null) {
  recorded.events.length = 0;
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
    expect(eventTypes()).toEqual(["model_step"]);
    const [step] = recorded.events;
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
    expect(eventTypes()).toEqual(["model_step", "tool_result", "model_step"]);
    const toolResult = recorded.events[1];
    expect(
      toolResult.type === "tool_result" && [toolResult.toolCallId, toolResult.content]
    ).toEqual(["c1", "ran ls"]);
  });

  it("manual mode: pending approval ends the graph after the tools node", async () => {
    const { compiled, log, model } = build([
      { toolCalls: [toolCall("run_mutating_command", { command: "rm x" }, "c1")] },
      "should not be reached",
    ]);
    const result = await invoke(compiled, { messages: [new HumanMessage("delete")] });
    expect(types(result.messages)).toEqual(["human", "ai", "tool"]);
    expect(decodeToolResult(result.messages.at(-1)?.content)).toEqual({
      status: "pending",
      prompt: { kind: "confirm", label: "rm x" },
    });
    expect(log).toEqual([]);
    expect(model.calls.length).toBe(1);
    const state = await compiled.getState(config());
    expect(state.next).toEqual([]);
    expect(eventTypes()).toEqual(["model_step", "tool_result"]);
  });

  it("accept edits mode: mutating tool runs without stopping", async () => {
    const { compiled, log } = build(
      [{ toolCalls: [toolCall("run_mutating_command", { command: "rm x" }, "c1")] }, "done"],
      { mode: "accept edits" }
    );
    const result = await invoke(compiled, { messages: [new HumanMessage("delete")] });
    expect(types(result.messages)).toEqual(["human", "ai", "tool", "ai"]);
    expect(log).toEqual(["mutate:rm x"]);
  });

  it("resume: patched tool result under 'tools' re-enters the agent node", async () => {
    const { compiled, model } = build([
      { toolCalls: [toolCall("run_mutating_command", { command: "rm x" }, "c1")] },
      "finished after approval",
    ]);
    await invoke(compiled, { messages: [new HumanMessage("delete")] });

    const patched = await respondToPromptResult(compiled, THREAD, "c1", true, approve);
    expect(patched).toEqual({
      index: 2,
      toolCallId: "c1",
      name: "run_mutating_command",
      status: "approved",
      result: 'approved run_mutating_command: {"command":"rm x"}',
    });

    const afterPatch = await compiled.getState(config());
    expect(afterPatch.next).toEqual(["agent"]);
    expect(String(afterPatch.values.messages[2].content)).toBe(
      'approved run_mutating_command: {"command":"rm x"}'
    );

    const result = await invoke(compiled, null);
    expect(types(result.messages)).toEqual(["human", "ai", "tool", "ai"]);
    expect(String(result.messages.at(-1)?.content)).toBe("finished after approval");

    const lastModelInput = model.calls.at(-1)!;
    expect(String(lastModelInput.at(-1)?.content)).toBe(
      'approved run_mutating_command: {"command":"rm x"}'
    );
  });

  it("resume on an empty thread throws EmptyInputError", async () => {
    const { compiled } = build(["never"]);
    await expect(invoke(compiled, null)).rejects.toThrow(/no input writes/);
  });

  it("respondToPromptResult returns null when the tool call id is unknown", async () => {
    const { compiled } = build([
      { toolCalls: [toolCall("run_mutating_command", { command: "rm x" }, "c1")] },
    ]);
    await invoke(compiled, { messages: [new HumanMessage("delete")] });
    expect(await respondToPromptResult(compiled, THREAD, "missing", true, approve)).toBeNull();
    const state = await compiled.getState(config());
    expect(state.next).toEqual([]);
  });

  it("respondToPromptResult returns null when the tool result is not pending", async () => {
    const { compiled } = build([
      { toolCalls: [toolCall("run_read_only_command", { command: "ls" }, "c1")] },
      "done",
    ]);
    await invoke(compiled, { messages: [new HumanMessage("list")] });
    expect(await respondToPromptResult(compiled, THREAD, "c1", true, approve)).toBeNull();
  });

  it("reject: injects a rejection result and the agent continues without the tool running", async () => {
    const { compiled, model, log } = build([
      { toolCalls: [toolCall("run_mutating_command", { command: "rm x" }, "c1")] },
      "ok, skipped",
    ]);
    await invoke(compiled, { messages: [new HumanMessage("delete")] });

    const patched = await respondToPromptResult(compiled, THREAD, "c1", false, approve);
    expect(patched?.status).toBe("rejected");
    expect(decodeToolResult(patched?.result)).toEqual({ status: "rejected" });
    expect(patched?.result).toContain("rm x");

    const result = await invoke(compiled, null);
    expect(types(result.messages)).toEqual(["human", "ai", "tool", "ai"]);
    expect(log).toEqual([]);
    expect(String(model.calls.at(-1)!.at(-1)?.content)).toContain("[USER_REJECTED]");
  });

  it("confirm prompt rejects a string value", async () => {
    const { compiled } = build([
      { toolCalls: [toolCall("run_mutating_command", { command: "rm x" }, "c1")] },
    ]);
    await invoke(compiled, { messages: [new HumanMessage("delete")] });
    await expect(respondToPromptResult(compiled, THREAD, "c1", "yes", approve)).rejects.toThrow(
      /expects a boolean/
    );
  });

  it("refresh: rehydrate from UI history, then resume", async () => {
    const uiMessages: Message[] = [
      { id: "u1", role: "user", content: "delete" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "c1",
            name: "run_mutating_command",
            args: { command: "rm x" },
            status: "pending",
            result: createPendingResult({ kind: "confirm", label: "rm x" }),
          },
        ],
      },
    ];
    const history = buildHistory(uiMessages);

    const { compiled } = build(["finished after refresh"]);
    await rehydrateHistory(compiled, THREAD, history);

    const seeded = await compiled.getState(config());
    expect(types(seeded.values.messages)).toEqual(["human", "ai", "tool"]);

    const patched = await respondToPromptResult(compiled, THREAD, "c1", true, approve);
    expect(patched?.index).toBe(2);
    const result = await invoke(compiled, null);
    expect(String(result.messages.at(-1)?.content)).toBe("finished after refresh");
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
    expect(eventTypes()).toEqual(["model_step", "exit_retry", "model_step"]);
  });

  it("entry interceptor runs for a human prompt but not on resume", async () => {
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
    await respondToPromptResult(compiled, THREAD, "c1", true, approve);
    await invoke(compiled, null);
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
});
