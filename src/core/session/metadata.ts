import YAML from "yaml";
import type { FileStore } from "../ports";
import { join, dirname } from "../paths";
import type { SessionMetadata } from "../../types/persistence";

function getSessionMetadataPath(workspaceDir: string, sessionId: string): string {
  return join(workspaceDir, ".allonomic", "sessions", sessionId, "metadata.yml");
}

export async function loadSessionMetadata(
  fs: FileStore,
  workspaceDir: string,
  sessionId: string
): Promise<SessionMetadata | null> {
  const filePath = getSessionMetadataPath(workspaceDir, sessionId);
  try {
    const raw = await fs.readText(filePath);
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
      title: typeof title === "string" ? title : "Chat",
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
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (
      !errorMsg.includes("No such file") &&
      !errorMsg.includes("os error 2") &&
      !errorMsg.includes("system cannot find the path")
    ) {
      console.error("[SessionMetadata] Error loading session metadata:", error);
      globalThis.alert?.("Failed to parse session metadata: " + errorMsg);
    }
    return null;
  }
}

export async function saveSessionMetadata(
  fs: FileStore,
  workspaceDir: string,
  metadata: SessionMetadata
): Promise<void> {
  const filePath = getSessionMetadataPath(workspaceDir, metadata.sessionId);
  await fs.mkdir(dirname(filePath));

  const existing: unknown = (await fs.exists(filePath))
    ? YAML.parse(await fs.readText(filePath))
    : undefined;
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
  const sessionsRoot = join(workspaceDir, ".allonomic", "sessions");
  try {
    const entries = await fs.readDir(sessionsRoot);
    const dirNames = entries.filter((e) => e.isDirectory).map((e) => e.name);

    const list: SessionMetadata[] = [];
    for (const id of dirNames) {
      const meta = await loadSessionMetadata(fs, workspaceDir, id);
      if (meta) {
        list.push(meta);
      } else {
        // Create fallback metadata if folder exists without metadata.yml
        list.push({
          sessionId: id,
          title: id,
          closed: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // Sort by most recently updated
    return list.toSorted(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (
      !errorMsg.includes("No such file") &&
      !errorMsg.includes("os error 2") &&
      !errorMsg.includes("system cannot find the path")
    ) {
      console.error("[SessionMetadata] Error listing sessions:", error);
      globalThis.alert?.("Failed to list sessions: " + errorMsg);
    }
    return [];
  }
}
