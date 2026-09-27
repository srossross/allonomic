import type { ExecutionMode } from "@/types";
import type { Runtime } from "../ports";
import { createFilesystemTools } from "./filesystem";
import { createShellTools } from "./shell";

export interface AgentToolOptions {
  approved?: boolean;
}

export function createAgentTools(
  runtime: Runtime,
  workspaceDir: string = ".",
  executionMode: ExecutionMode = "accept edits",
  options: AgentToolOptions = {}
) {
  return [
    ...createFilesystemTools(runtime, workspaceDir, executionMode, options),
    ...createShellTools(runtime, workspaceDir, executionMode, options),
  ];
}

export * from "./filesystem";
export * from "./shell";
export * from "./specs";
