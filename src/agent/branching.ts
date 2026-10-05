import { tauriRuntime } from "../adapters/tauri/runtime";
import {
  rehydrateSession,
  replayGovernorState,
  replaySession,
  rewindSession,
} from "../core/session/rehydration";
import { forkSession } from "../core/session/fork";
import { sessionDirFor } from "../core/session/metadata";
import type { TurnHead } from "../core/turn/branches";
import type { RehydratedSession } from "../types/persistence";
import { findAgentInstance } from "./server";

export async function rewindAgentSession(
  workspaceDir: string,
  sessionId: string,
  head: TurnHead
): Promise<RehydratedSession> {
  const workspace = await tauriRuntime.paths.resolve(workspaceDir);
  const instance = findAgentInstance(workspace, sessionId);
  const sessionDir = sessionDirFor(workspace, sessionId);
  const rewind = () => rewindSession(tauriRuntime.fs, sessionDir, head);
  if (instance) {
    await instance.runner.resetThread(rewind);
    const { activeEvents } = await replaySession(tauriRuntime.fs, sessionDir);
    instance.governor.state = replayGovernorState(activeEvents);
  } else {
    await rewind();
  }
  return await rehydrateSession(tauriRuntime.fs, workspace, sessionId);
}

export async function forkAgentSession(
  workspaceDir: string,
  sessionId: string,
  head: TurnHead
): Promise<string> {
  const workspace = await tauriRuntime.paths.resolve(workspaceDir);
  const forkId = `session-${Date.now()}`;
  await forkSession(tauriRuntime, workspace, sessionId, forkId, head);
  return forkId;
}
