import { tool, type StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { PreToolDecision } from "../governor/tools";

export function createTeacherPreToolTools(
  signalDecision: (decision: PreToolDecision) => void
): StructuredTool[] {
  const allow = tool(
    async () => {
      signalDecision({ approved: true });
      return { status: "allowed" };
    },
    {
      name: "allow",
      description: "The proposed tool call follows the rules.",
      schema: z.object({}),
    }
  );

  const deny = tool(
    async ({ reason }) => {
      signalDecision({ approved: false, reason });
      return { status: "denied", reason };
    },
    {
      name: "deny",
      description: "Block the proposed tool call because it breaks a rule.",
      schema: z.object({
        reason: z.string().describe("The rule that was broken and the exact call to make instead."),
      }),
    }
  );

  return [allow, deny];
}

export type PostToolDecision = { lesson?: string };

export function createTeacherPostToolTools(
  signalDecision: (decision: PostToolDecision) => void
): StructuredTool[] {
  const ok = tool(
    async () => {
      signalDecision({});
      return { status: "ok" };
    },
    {
      name: "ok",
      description: "Nothing to teach: the failure is not about tool usage.",
      schema: z.object({}),
    }
  );

  const teach = tool(
    async ({ lesson }) => {
      signalDecision({ lesson });
      return { status: "taught" };
    },
    {
      name: "teach",
      description: "Tell the agent why the tool call failed and how to fix it.",
      schema: z.object({
        lesson: z
          .string()
          .describe("The cause of the failure and the exact tool and args to use next."),
      }),
    }
  );

  return [ok, teach];
}
