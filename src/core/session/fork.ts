import type { Runtime } from "../ports";
import type { TurnHead } from "../turn/branches";
import { loadScopedSettings, saveSettingsLayer } from "../config/scopedSettings";
import { loadSessionMetadata, saveSessionMetadata, sessionDirFor } from "./metadata";
import { copyActivePath } from "./rehydration";
import { join } from "../paths";
import { DEFAULT_CHAT_TITLE } from "../../types";

export async function forkSession(
  runtime: Runtime,
  workspaceDir: string,
  fromId: string,
  toId: string,
  head: TurnHead
): Promise<void> {
  const { fs } = runtime;
  const fromDir = sessionDirFor(workspaceDir, fromId);
  const toDir = sessionDirFor(workspaceDir, toId);
  await fs.mkdir(toDir);
  const turnCount = await copyActivePath(fs, fromDir, toDir, head);

  const metadataPath = join(fromDir, "metadata.yml");
  if (await fs.exists(metadataPath))
    await fs.writeText(join(toDir, "metadata.yml"), await fs.readText(metadataPath));
  const source = await loadSessionMetadata(fs, workspaceDir, fromId);
  const now = new Date().toISOString();
  await saveSessionMetadata(fs, workspaceDir, {
    sessionId: toId,
    title: `(fork) ${source?.title ?? DEFAULT_CHAT_TITLE}`,
    closed: false,
    createdAt: now,
    updatedAt: now,
    turnCount,
    lastPrompt: source?.lastPrompt,
  });

  const { layers } = await loadScopedSettings(runtime, workspaceDir, fromId);
  await saveSettingsLayer(runtime, workspaceDir, toId, "session", layers.session);
}
