import {
  EXECUTION_MODE_LEVELS,
  type AccessLevel,
  type ExecutionMode,
  type UserPrompt,
} from "@/types";
import { readPipelineContext, readToolCallId } from "../graph/types";

export type ExecutionModeSource = ExecutionMode | (() => Promise<ExecutionMode>);

export async function currentMode(source: ExecutionModeSource): Promise<ExecutionMode> {
  return typeof source === "function" ? await source() : source;
}

export function requiresApproval(level: AccessLevel, executionMode: ExecutionMode): boolean {
  return level > EXECUTION_MODE_LEVELS[executionMode];
}

export async function askUserFromTool(config: unknown, prompt: UserPrompt) {
  return await readPipelineContext(config).askUser(prompt, readToolCallId(config));
}

export async function isConfirmedByUser(config: unknown, prompt: UserPrompt): Promise<boolean> {
  return (await askUserFromTool(config, prompt)) === true;
}
