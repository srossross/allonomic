import YAML from "yaml";
import type { DirEntry, FileStore } from "../ports";
import { isNotFound } from "../fsErrors";
import { join, dirname } from "../paths";
import type { SessionMetadata } from "../../types/persistence";
import { DEFAULT_CHAT_TITLE } from "../../types/tab";

function sessionsRootFor(workspaceDir: string): string {
  return join(workspaceDir, ".allonomic", "sessions");
}

export function sessionDirFor(workspaceDir: string, sessionId: string): string {
  return join(sessionsRootFor(workspaceDir), sessionId);
}

function getSessionMetadataPath(workspaceDir: string, sessionId: string): string {
  return join(sessionDirFor(workspaceDir, sessionId), "metadata.yml");
}

async function readIfExists(fs: FileStore, path: string): Promise<string | undefined> {
  try {
    return await fs.readText(path);
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

export async function loadSessionMetadata(
  fs: FileStore,
  workspaceDir: string,
  sessionId: string
): Promise<SessionMetadata | null> {
  const filePath = getSessionMetadataPath(workspaceDir, sessionId);
  const raw = await readIfExists(fs, filePath);
  if (raw === undefined) return null;
  const data: unknown = YAML.parse(raw);
  if (!data || typeof data !== "object") return null;

  const session_id = Reflect.get(data, "session_id");
  const sessionIdField = Reflect.get(data, "sessionId");
  const title = Reflect.get(data, "title");
  const closed = Reflect.get(data, "closed");
  const created_at = Reflect.get(data, "created_at");
  const createdAt = Reflect.get(data, "createdAt");
  const updated_at = Reflect.get(data, "updated_at");
  const updatedAt = Reflect.get(data, "updatedAt");
  const turn_count = Reflect.get(data, "turn_count");
  const last_prompt = Reflect.get(data, "last_prompt");

  return {
    sessionId: String(session_id || sessionIdField || sessionId),
    title: typeof title === "string" ? title : DEFAULT_CHAT_TITLE,
    closed: closed === true,
    createdAt:
      typeof created_at === "string"
        ? created_at
        : typeof createdAt === "string"
          ? createdAt
          : new Date().toISOString(),
    updatedAt:
      typeof updated_at === "string"
        ? updated_at
        : typeof updatedAt === "string"
          ? updatedAt
          : new Date().toISOString(),
    turnCount: typeof turn_count === "number" ? turn_count : undefined,
    lastPrompt: typeof last_prompt === "string" ? last_prompt : undefined,
  };
}

export async function saveSessionMetadata(
  fs: FileStore,
  workspaceDir: string,
  metadata: SessionMetadata
): Promise<void> {
  const filePath = getSessionMetadataPath(workspaceDir, metadata.sessionId);
  await fs.mkdir(dirname(filePath));

  const raw = await readIfExists(fs, filePath);
  const existing: unknown = raw === undefined ? undefined : YAML.parse(raw);
  const yml = YAML.stringify({
    ...(typeof existing === "object" && existing),
    session_id: metadata.sessionId,
    title: metadata.title,
    closed: metadata.closed,
    created_at: metadata.createdAt,
    updated_at: metadata.updatedAt || new Date().toISOString(),
    turn_count: metadata.turnCount ?? 0,
    last_prompt: metadata.lastPrompt || "",
  });

  await fs.writeText(filePath, yml);
}

export async function listSessions(
  fs: FileStore,
  workspaceDir: string
): Promise<SessionMetadata[]> {
  const sessionsRoot = sessionsRootFor(workspaceDir);
  let entries: DirEntry[];
  try {
    entries = await fs.readDir(sessionsRoot);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  const dirNames = entries.filter((e) => e.isDirectory).map((e) => e.name);

  const list: SessionMetadata[] = [];
  for (const id of dirNames) {
    const meta = await loadSessionMetadata(fs, workspaceDir, id);
    if (meta) {
      list.push(meta);
    } else {
      list.push({
        sessionId: id,
        title: id,
        closed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return list.toSorted((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
