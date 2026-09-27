/**
 * @ai-instruction DO NOT replace this system with an opaque database (like SqliteSaver).
 * We deliberately use an Event-Sourced YAML architecture so that all agent thoughts,
 * tool calls, and state transitions remain human-readable, auditable, and manually editable on disk.
 */
import type { FileStore } from "../ports";
import { join } from "../paths";
import { DEFAULT_MODEL_ID } from "../../types/chat";
import { INITIAL_TOOLS } from "../../types/tab";
import type { RehydratedSession, SessionMetadata } from "../../types/persistence";
import { loadSessionMetadata, saveSessionMetadata } from "./metadata";
import { loadSessionTurns, nextTurnIndexAfter } from "../turn/turnFiles";
import { foldTurnEvents } from "../turn/transcript";

async function loadOrCreateMetadata(
  fs: FileStore,
  workspaceDir: string,
  sessionId: string
): Promise<SessionMetadata> {
  const existing = await loadSessionMetadata(fs, workspaceDir, sessionId);
  if (existing) return existing;
  const metadata: SessionMetadata = {
    sessionId,
    title: sessionId,
    closed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    model: DEFAULT_MODEL_ID,
    thinkingLevel: "Low",
    enabledTools: INITIAL_TOOLS,
  };
  await saveSessionMetadata(fs, workspaceDir, metadata);
  return metadata;
}

function reportTurnError(turnIndex: number, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to load turn ${turnIndex} during rehydration:`, error);
  globalThis.alert(`Failed to load turn ${turnIndex} during rehydration: ${message}`);
}

export async function rehydrateSession(
  fs: FileStore,
  workspaceDir: string,
  sessionId: string
): Promise<RehydratedSession> {
  const sessionDir = join(workspaceDir, ".allonomic/sessions", sessionId);
  const metadata = await loadOrCreateMetadata(fs, workspaceDir, sessionId);
  const { turnNumbers, events } = await loadSessionTurns(fs, sessionDir, reportTurnError);
  return { metadata, ...foldTurnEvents(events), nextTurnIndex: nextTurnIndexAfter(turnNumbers) };
}
