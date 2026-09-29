import { describe, it, expect } from "bun:test";
import { MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { ToolTeacherInterceptor } from "../src/core/teacher/interceptor";
import { createCompiledWorkflow } from "../src/core/graph/workflow";
import { recoverToolCalls } from "../src/core/graph/recovery";
import { rehydrateSession } from "../src/core/session/rehydration";
import { createTurnEventLog } from "../src/core/turn/eventLog";
import { saveTurnEvents } from "../src/core/telemetry/session";
import type { TurnEvent } from "../src/core/turn/events";
import { messageText } from "../src/core/graph/thinking";
import { FakeChatModel, toolCall } from "./helpers/fakeChatModel";
import { scriptedGovernorModel } from "./helpers/governorModel";
import { instructionsOf } from "./helpers/governorForks";
import { recordingContext } from "./helpers/turnContext";

const FAILED = "[STDERR]:\nOperation not permitted\n[exit 1 in 3ms]";
const CALL = { id: "c1", name: "shell_1_project_read_only", args: { command: "uv run pytest" } };

async function teacherRuntime() {
  const runtime = createMemoryRuntime();
  for (const name of ["teacher", "pre_tool", "post_tool"]) {
    await runtime.fs.writeText(
      `/resources/app-data/prompts/teacher/${name}.md`,
      name.toUpperCase()
    );
  }
  return runtime;
}

async function scriptedTeacher(script: Parameters<typeof scriptedGovernorModel>[0]) {
  const runtime = await teacherRuntime();
  const model = scriptedGovernorModel(script);
  const teacher = new ToolTeacherInterceptor({
    runtime,
    apiKey: "test",
    createModel: model.createModel,
  });
  return { runtime, model, teacher };
}

const conversation: BaseMessage[] = [
  new SystemMessage("worker system prompt"),
  new HumanMessage("run the tests"),
  new AIMessage({ content: "running tests", tool_calls: [CALL] }),
];

const failingShell = tool(async () => FAILED, {
  name: CALL.name,
  description: "shell",
  schema: z.object({ command: z.string() }),
});

describe("ToolTeacher pre-tool", () => {
  it("denies with the lesson as the reason and records the decision", async () => {
    const { teacher } = await scriptedTeacher([
      { name: "deny", args: { reason: "use modify_sandbox_permissions" } },
    ]);
    const { context, events } = recordingContext();

    const approval = await teacher.onPreToolCall(CALL, conversation, context);

    expect(approval).toEqual({ approved: false, reason: "use modify_sandbox_permissions" });
    expect(events.find((e) => e.type === "governor_tool_decision")).toMatchObject({
      interceptor: "ToolTeacher",
      toolCallId: "c1",
      approved: false,
    });
  });

  it("includes agents/tools.md and current settings when the file exists", async () => {
    const { runtime, teacher } = await scriptedTeacher([{ name: "allow" }]);
    await runtime.fs.writeText("/workspace/agents/tools.md", "RULE_X");
    const { context, events } = recordingContext();

    await teacher.onPreToolCall(CALL, conversation, context);

    const instructions = instructionsOf(events, "pre_tool.md");
    expect(instructions).toContain("TEACHER");
    expect(instructions).toContain("PRE_TOOL");
    expect(instructions).toContain("RULE_X");
    expect(instructions).toContain("## Current Settings");
    expect(instructions).toContain(`Call: c1 ${CALL.name}`);
  });

  it("omits the project rules section when agents/tools.md is absent", async () => {
    const { teacher } = await scriptedTeacher([{ name: "allow" }]);
    const { context, events } = recordingContext();

    await teacher.onPreToolCall(CALL, conversation, context);

    expect(instructionsOf(events, "pre_tool.md")).not.toContain("Project Rules");
  });

  it("records the files it loaded, flagging missing user and project agents/tools.md", async () => {
    const { teacher } = await scriptedTeacher([{ name: "allow" }]);
    const { context, events } = recordingContext();

    await teacher.onPreToolCall(CALL, conversation, context);

    const loaded = events.find((e) => e.type === "context_files_loaded");
    expect(loaded).toMatchObject({ agent: "teacher", hook: "preTool" });
    expect(
      loaded?.type === "context_files_loaded" &&
        loaded.files.map((file) => [file.path, file.missing])
    ).toEqual([
      ["/resources/app-data/prompts/teacher/teacher.md", false],
      ["/resources/app-data/prompts/teacher/pre_tool.md", false],
      ["/home/test/.allonomic/agents/tools.md", true],
      ["/workspace/agents/tools.md", true],
    ]);
  });
});

describe("ToolTeacher post-tool", () => {
  it("does nothing on exit 0", async () => {
    const { model, teacher } = await scriptedTeacher([]);
    const { context } = recordingContext();
    const ok = new ToolMessage({ content: "ok\n[exit 0 in 1ms]", tool_call_id: "c1" });

    expect(await teacher.onPostToolCall(CALL, ok, conversation, context)).toBeUndefined();
    expect(model.calls()).toBe(0);
  });

  it("returns the lesson on a non-zero exit", async () => {
    const { teacher } = await scriptedTeacher([
      { name: "teach", args: { lesson: "request allow_write ~/.cache/uv at level 1" } },
    ]);
    const { context } = recordingContext();
    const failed = new ToolMessage({ content: FAILED, tool_call_id: "c1" });

    expect(await teacher.onPostToolCall(CALL, failed, conversation, context)).toBe(
      "request allow_write ~/.cache/uv at level 1"
    );
  });

  it("returns no lesson when the teacher calls ok()", async () => {
    const { teacher } = await scriptedTeacher([{ name: "ok" }]);
    const { context } = recordingContext();
    const failed = new ToolMessage({ content: FAILED, tool_call_id: "c1" });

    expect(await teacher.onPostToolCall(CALL, failed, conversation, context)).toBeUndefined();
  });

  it("never forks when disabled", async () => {
    const { model, teacher } = await scriptedTeacher([]);
    teacher.setIsEnabled(false);
    const { context } = recordingContext();
    const failed = new ToolMessage({ content: FAILED, tool_call_id: "c1" });

    expect(await teacher.onPreToolCall(CALL, conversation, context)).toEqual({ approved: true });
    expect(await teacher.onPostToolCall(CALL, failed, conversation, context)).toBeUndefined();
    expect(model.calls()).toBe(0);
  });
});

describe("ToolTeacher in the pipeline", () => {
  it("appends the lesson to the failed tool result and its event", async () => {
    const { teacher } = await scriptedTeacher([
      { name: "allow" },
      { name: "teach", args: { lesson: "LESSON" } },
    ]);
    const compiled = createCompiledWorkflow(
      new FakeChatModel([{ toolCalls: [toolCall(CALL.name, CALL.args, "c1")] }, "done"]),
      new ToolNode([failingShell]),
      new MemorySaver(),
      [teacher],
      "system"
    );
    const { context, events } = recordingContext();

    const { messages } = await compiled.invoke(
      { messages: [new HumanMessage("go")] },
      { configurable: { thread_id: "t1", context }, recursionLimit: 20 }
    );

    const result = messages.find((m: BaseMessage): m is ToolMessage => m instanceof ToolMessage);
    const expected = `${FAILED}\n\n[ToolTeacher]: LESSON`;
    expect(messageText(result!.content)).toBe(expected);
    const toolResult = events.find(
      (e): e is Extract<TurnEvent, { type: "tool_result" }> => e.type === "tool_result"
    );
    expect(toolResult?.content).toBe(expected);
  });
});

const rerun = () => recordingContext("t1", 2, async () => "rerun");

describe("ToolTeacher in crash recovery", () => {
  it("records which interceptors decided an unanswered call", async () => {
    const runtime = createMemoryRuntime();
    const { sink, events } = createTurnEventLog(1, []);
    sink.emit({ type: "turn_started", threadId: "s1", prompt: "test" });
    sink.emit({ type: "model_step", stepId: "s", content: "", toolCalls: [CALL], durationMs: 1 });
    sink.emit({
      type: "governor_tool_decision",
      interceptor: "ToolTeacher",
      tool: CALL.name,
      toolCallId: "c1",
      args: CALL.args,
      approved: true,
    });
    await saveTurnEvents(runtime.fs, "/w/.allonomic/sessions/s1", 1, events);

    const session = await rehydrateSession(runtime.fs, "/w", "s1");

    expect(session.unansweredCalls).toEqual([{ ...CALL, decidedBy: ["ToolTeacher"] }]);
  });

  it("skips pre-tool when the teacher already decided, and still teaches", async () => {
    const { model, teacher } = await scriptedTeacher([
      { name: "teach", args: { lesson: "LESSON" } },
    ]);
    const { context } = rerun();

    const [result] = await recoverToolCalls([{ ...CALL, decidedBy: ["ToolTeacher"] }], {
      tools: [failingShell],
      interceptors: [teacher],
      conversation,
      context,
    });

    expect(model.calls()).toBe(1);
    expect(messageText(result.content)).toEndWith("[ToolTeacher]: LESSON");
  });

  it("runs pre-tool when the teacher had not decided", async () => {
    const { model, teacher } = await scriptedTeacher([{ name: "deny", args: { reason: "NOPE" } }]);
    const { context } = rerun();

    const [result] = await recoverToolCalls([{ ...CALL, decidedBy: [] }], {
      tools: [failingShell],
      interceptors: [teacher],
      conversation,
      context,
    });

    expect(model.calls()).toBe(1);
    expect(messageText(result.content)).toBe("[INTERCEPTED by ToolTeacher]: NOPE");
  });
});
