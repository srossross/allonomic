import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createPendingResult } from "../../src/core/userPrompt";
import type { ExecutionMode } from "../../src/types";

export function createFakeTools(executionMode: ExecutionMode, log: string[] = []) {
  const readOnly = tool(
    async ({ command }) => {
      log.push(`read:${command}`);
      return `ran ${command}`;
    },
    {
      name: "run_read_only_command",
      description: "read only",
      schema: z.object({ command: z.string() }),
    }
  );

  const mutating = tool(
    async ({ command }) => {
      if (executionMode === "manual") {
        return createPendingResult({ kind: "confirm", label: command });
      }
      log.push(`mutate:${command}`);
      return `mutated ${command}`;
    },
    {
      name: "run_mutating_command",
      description: "mutating",
      schema: z.object({ command: z.string() }),
    }
  );

  return { tools: [readOnly, mutating], log };
}
