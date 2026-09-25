import { describe, it, expect } from "bun:test";
import { GovernorInterceptor } from "../src/interceptor-agents/governor/interceptor";
import type { PipelineContext } from "../src/interceptor-agents/pipeline/types";

describe("Governor Pre-Tool Interception Flow", () => {
  const dummyContext: PipelineContext = {
    workspaceDir: process.cwd(),
    sessionId: "test-session",
    turnIndex: 1,
    preToolLogs: [],
  };

  it("blocks mutating tools when active intent is 'question'", async () => {
    const governor = new GovernorInterceptor({
      initialState: {
        intent_stack: [
          {
            id: "itnt_q1",
            kind: "question",
            description: "Can we install python?",
            constraints: [],
          },
        ],
      },
    });

    // 1. write_file should be blocked
    const writeApproval = await governor.onPreToolCall(
      { name: "write_file", args: { path: "hello.py", content: "print(1)" } },
      dummyContext
    );
    expect(writeApproval.approved).toBe(false);
    expect(writeApproval.reason).toContain("Blocked by Governor");
    expect(writeApproval.reason).toContain("question");

    // 2. run_command should be blocked
    const cmdApproval = await governor.onPreToolCall(
      { name: "run_command", args: { command: "brew install python" } },
      dummyContext
    );
    expect(cmdApproval.approved).toBe(false);
    expect(cmdApproval.reason).toContain("Blocked by Governor");

    // 3. read_file should be permitted
    const readApproval = await governor.onPreToolCall(
      { name: "read_file", args: { path: "README.md" } },
      dummyContext
    );
    expect(readApproval.approved).toBe(true);

    // 4. list_dir should be permitted
    const listApproval = await governor.onPreToolCall(
      { name: "list_dir", args: { path: "." } },
      dummyContext
    );
    expect(listApproval.approved).toBe(true);
  });

  it("blocks mutating tools when active intent is 'unknown'", async () => {
    const governor = new GovernorInterceptor({
      initialState: {
        intent_stack: [
          {
            id: "itnt_u1",
            kind: "unknown",
            description: "Unclear user prompt",
            constraints: [],
          },
        ],
      },
    });

    const approval = await governor.onPreToolCall(
      { name: "write_file", args: { path: "danger.txt", content: "bad" } },
      dummyContext
    );
    expect(approval.approved).toBe(false);
    expect(approval.reason).toContain("unknown");
  });

  it("permits mutating tools when active intent is 'request'", async () => {
    const governor = new GovernorInterceptor({
      initialState: {
        intent_stack: [
          {
            id: "itnt_r1",
            kind: "request",
            description: "Create hello.txt file",
            constraints: [],
          },
        ],
      },
    });

    const approval = await governor.onPreToolCall(
      { name: "write_file", args: { path: "hello.txt", content: "Hello world" } },
      dummyContext
    );
    expect(approval.approved).toBe(true);
  });
});
