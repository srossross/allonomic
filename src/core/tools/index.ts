import { DEFAULT_EXECUTION_MODE } from "@/types";
import type { Runtime } from "../ports";
import type { ExecutionModeSource } from "./approval";
import { createFilesystemTools } from "./filesystem";
import { createShellTools } from "./shell";
import { createPermissionTools } from "./permissions";
import { createWebTools } from "./web";
import type { ToolStops } from "./toolStops";
import type { BackgroundJobs } from "../jobs/backgroundJobs";
import type { CreateShellReaderModel } from "./shellReader";

export interface AgentToolOptions {
  sessionId?: string;
  stops?: ToolStops;
  jobs?: BackgroundJobs;
  createShellReaderModel?: CreateShellReaderModel;
}

export function createAgentTools(
  runtime: Runtime,
  workspaceDir: string = ".",
  executionMode: ExecutionModeSource = DEFAULT_EXECUTION_MODE,
  options: AgentToolOptions = {}
) {
  return [
    ...createFilesystemTools(runtime, workspaceDir, executionMode, options),
    ...createShellTools(runtime, workspaceDir, executionMode, options),
    ...createPermissionTools(runtime, workspaceDir, options),
    ...createWebTools(runtime, workspaceDir, options),
  ];
}

export * from "./filesystem";
export * from "./shell";
export * from "./web";
export * from "./specs";
