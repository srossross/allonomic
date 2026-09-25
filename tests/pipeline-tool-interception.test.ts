import { describe, it, expect } from "bun:test";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createInterceptedTools } from "../src/interceptor-agents/pipeline/interceptedTools";
import { GovernorInterceptor } from "../src/interceptor-agents/governor/interceptor";

describe("Pipeline Tool Interception & Interceptor Gating Flow", () => {
  it("intercepts and blocks tool execution when Governor disallows mutating tool", async () => {
    let isRawToolExecuted = false;

    const dummyWriteTool = tool(
      async ({ path, content }) => {
        isRawToolExecuted = true;
        return `Wrote to ${path}: ${content}`;
      },
      {
        name: "write_file",
        description: "Write content to a file",
        schema: z.object({
          path: z.string(),
          content: z.string(),
        }),
      }
    );

    const governor = new GovernorInterceptor({
      initialState: {
        intent_stack: [
          {
            id: "itnt_q_only",
            kind: "question",
            description: "How does the app compile?",
            constraints: [],
          },
        ],
      },
    });

    const interceptedTools = createInterceptedTools({
      tools: [dummyWriteTool],
      interceptors: [governor],
      workspaceDir: process.cwd(),
      sessionId: "session_test",
      turnIndex: 1,
    });

    expect(interceptedTools.length).toBe(1);
    const interceptedWrite = interceptedTools[0];

    const result = await interceptedWrite.invoke({
      path: "test.txt",
      content: "should not be written",
    });

    // The raw tool must not have been executed
    expect(isRawToolExecuted).toBe(false);
    expect(typeof result).toBe("string");
    expect(result).toContain("[INTERCEPTED by Governor]");
    expect(result).toContain("question");
  });

  it("permits and executes tool when Governor approves", async () => {
    let isRawToolExecuted = false;

    const dummyReadTool = tool(
      async ({ path }) => {
        isRawToolExecuted = true;
        return `File content of ${path}`;
      },
      {
        name: "read_file",
        description: "Read a file",
        schema: z.object({
          path: z.string(),
        }),
      }
    );

    const governor = new GovernorInterceptor({
      initialState: {
        intent_stack: [
          {
            id: "itnt_q_only",
            kind: "question",
            description: "Explain package.json",
            constraints: [],
          },
        ],
      },
    });

    const interceptedTools = createInterceptedTools({
      tools: [dummyReadTool],
      interceptors: [governor],
      workspaceDir: process.cwd(),
      sessionId: "session_test",
      turnIndex: 1,
    });

    const result = await interceptedTools[0].invoke({ path: "package.json" });

    // Raw tool should have executed
    expect(isRawToolExecuted).toBe(true);
    expect(result).toBe("File content of package.json");
  });
});
