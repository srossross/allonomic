import type { Runtime } from "../ports";
import { createShellLauncher } from "../tools/shell";
import { ToolStops } from "../tools/toolStops";
import { BackgroundJobs, createFileJobStore } from "./backgroundJobs";

export interface SessionProcesses {
  stops: ToolStops;
  jobs: BackgroundJobs;
}

export function createSessionProcesses(
  runtime: Runtime,
  session: { workspaceDir: string; sessionId: string; getSessionDir(): string }
): SessionProcesses {
  return {
    stops: new ToolStops(),
    jobs: new BackgroundJobs(
      runtime.shell,
      runtime.fs,
      createShellLauncher(runtime, session.workspaceDir, session.sessionId),
      createFileJobStore(runtime.fs, () => session.getSessionDir())
    ),
  };
}
