import type { ExecutionMode } from "@/types";
import { createFilesystemTools } from "./filesystem";
import { createShellTools } from "./shell";

export function createAgentTools(
  workspaceDir: string = process.cwd(),
  executionMode: ExecutionMode = "accept edits"
) {
  return [...createFilesystemTools(workspaceDir, executionMode), ...createShellTools(workspaceDir, executionMode)];
}

export * from "./filesystem";
export * from "./shell";
