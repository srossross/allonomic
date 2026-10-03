import { describe, it, expect } from "bun:test";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { AgentRunner } from "../src/core/graph/runner";
import type { AgentInterceptor } from "../src/core/graph/types";
import { loadTurn, turnDirFor } from "../src/core/turn/turnFiles";
import type { BaseMessage } from "@langchain/core/messages";
import { updateSessionSettings } from "../src/core/config/settings";
import { FakeChatModel, toolCall } from "./helpers/fakeChatModel";

const SESSION_DIR = "/w/.allonomic/sessions/s1";
const READ = "shell_1_project_read_only";

const governor: AgentInterceptor = {
  name: "Governor",
  async onUserPrompt(_conversation, context) {
    context.events.emit({ type: "waiting", on: "Governor · entry.md", source: "Governor" });
    context.events.emit({
      type: "governor_action",
      phase: "entry",
      interceptor: "Governor",
      action: { type: "begin_prompt" },
    });
    return { text: "b", doneWhen: [] };
  },
  async onAgentFinish(_conversation, context) {
    context.events.emit({
      type: "governor_verdict",
      phase: "exit",
      interceptor: "Governor",
      approved: true,
    });
    return { allowFinish: true };
  },
};

const teacher: AgentInterceptor = {
  name: "ToolTeacher",
  async onPreToolCall(call, _conversation, context) {
    context.events.emit({
      type: "waiting",
      on: "ToolTeacher · pre_tool.md",
      source: "ToolTeacher",
    });
    context.events.emit({
      type: "governor_tool_decision",
      interceptor: "ToolTeacher",
      tool: call.name,
      toolCallId: call.id,
      args: call.args,
      approved: true,
    });
    return { approved: true };
  },
  async onPostToolCall(call, _result, _conversation, context) {
    context.events.emit({
      type: "governor_fork",
      interceptor: "ToolTeacher",
      phase: "post_tool",
      pass: "post_tool.md",
      messages: [],
    });
    return call.id === "c2" ? "LESSON" : undefined;
  },
};

describe("op-log routing", () => {
  it("writes one file per handoff and folds pass-through interceptors into the worker file", async () => {
    const runtime = createMemoryRuntime();
    const runner = new AgentRunner({
      runtime,
      workspaceDir: "/w",
      sessionId: "s1",
      executionMode: "restricted",
      interceptors: [teacher, governor],
      createModel: () =>
        new FakeChatModel([
          { toolCalls: [toolCall(READ, { command: "ls" }, "c1")] },
          { toolCalls: [toolCall(READ, { command: "ls" }, "c2")] },
          "done",
        ]),
    });

    await runner.run("go", "s1");

    const dir = turnDirFor(SESSION_DIR, 1);
    const entries = await runtime.fs.readDir(dir);
    const files = entries.map((e) => e.name);
    expect(files.toSorted((a, b) => a.localeCompare(b))).toEqual([
      "001-user.jsonl",
      "002-governor-entry.jsonl",
      "003-worker.jsonl",
      "004-toolteacher-post_tool.jsonl",
      "005-worker.jsonl",
    ]);

    const events = await loadTurn(runtime.fs, dir);
    const byActor = (actor: string) => events.filter((e) => e.actor === actor).map((e) => e.type);
    expect(byActor("user")).toEqual(["settings_changed", "turn_started"]);
    expect(byActor("Governor-entry")).toEqual(["waiting", "governor_action", "governor_brief"]);
    expect(byActor("ToolTeacher-post_tool")).toEqual(["governor_fork"]);
    expect(events.some((e) => e.type === "governor_tool_decision")).toBe(false);
    const passed = events.flatMap((e) =>
      e.type === "interceptor_passed" ? [`${e.interceptor}-${e.phase}-${e.toolCallId ?? ""}`] : []
    );
    expect(passed).toEqual([
      "ToolTeacher-pre_tool-c1",
      "ToolTeacher-post_tool-c1",
      "ToolTeacher-pre_tool-c2",
      "Governor-exit-",
    ]);
    expect(events.at(-1)?.type).toBe("turn_completed");
  });

  it("records a mid-turn settings change in a user file before the tool calls it affects", async () => {
    const runtime = createMemoryRuntime();
    class TogglingModel extends FakeChatModel {
      override async _generate(messages: BaseMessage[]) {
        if (this.calls.length === 1)
          await updateSessionSettings(runtime, "/w", "s1", { networkAccess: true });
        return await super._generate(messages);
      }
    }
    const runner = new AgentRunner({
      runtime,
      workspaceDir: "/w",
      sessionId: "s1",
      executionMode: "restricted",
      createModel: () =>
        new TogglingModel([
          { toolCalls: [toolCall(READ, { command: "ls" }, "c1")] },
          { toolCalls: [toolCall(READ, { command: "ls" }, "c2")] },
          "done",
        ]),
    });

    await runner.run("go", "s1");

    const dir = turnDirFor(SESSION_DIR, 1);
    const entries = await runtime.fs.readDir(dir);
    expect(entries.map((e) => e.name).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "001-user.jsonl",
      "002-worker.jsonl",
      "003-user.jsonl",
      "004-worker.jsonl",
    ]);
    const events = await loadTurn(runtime.fs, dir);
    const changes = events.flatMap((e) => (e.type === "settings_changed" ? [e.changes] : []));
    expect(Object.keys(changes[0])).toContain("networkAccess");
    expect(changes[1]).toEqual({ networkAccess: true });
    const changedAt = events.findIndex(
      (e) => e.type === "settings_changed" && e.actor === "user" && e.seq > 1
    );
    const secondResult = events.findIndex((e) => e.type === "tool_result" && e.toolCallId === "c2");
    expect(changedAt).toBeLessThan(secondResult);
  });
});
