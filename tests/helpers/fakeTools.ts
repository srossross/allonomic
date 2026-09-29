import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { isConfirmedByUser } from "../../src/core/tools/approval";
import { createRejectedResult } from "../../src/core/userPrompt";
import { EXECUTION_MODE_LEVELS, type ExecutionMode } from "../../src/types";

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
    async ({ command }, config) => {
      const prompt = { kind: "confirm" as const, label: command };
      if (EXECUTION_MODE_LEVELS[executionMode] < 3 && !(await isConfirmedByUser(config, prompt))) {
        return createRejectedResult("run_mutating_command", prompt);
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
