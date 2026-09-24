import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { SessionMetadata } from "../types/persistence";
import type { ThinkingLevel } from "../types/chat";
import { INITIAL_TOOLS } from "../types/tab";

export function getSessionMetadataPath(workspaceDir: string, sessionId: string): string {
  return path.join(workspaceDir, ".atomic", "sessions", sessionId, "metadata.yml");
}

const THINKING_LEVEL_SET = new Set(["Off", "Low", "Medium", "High"]);

function isThinkingLevel(val: unknown): val is ThinkingLevel {
  return typeof val === "string" && THINKING_LEVEL_SET.has(val);
}

function toStringArray(val: unknown): string[] {
  return Array.isArray(val) ? val.filter((item): item is string => typeof item === "string") : INITIAL_TOOLS;
}

export async function loadSessionMetadata(
  workspaceDir: string,
  sessionId: string
): Promise<SessionMetadata | null> {
  const filePath = getSessionMetadataPath(workspaceDir, sessionId);
  try {
    const raw = await fs.readFile(filePath, "utf8");
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
    const model = Reflect.get(data, "model");
    const thinking_level = Reflect.get(data, "thinking_level");
    const enabled_tools = Reflect.get(data, "enabled_tools");
    const turn_count = Reflect.get(data, "turn_count");
    const last_prompt = Reflect.get(data, "last_prompt");

    return {
      sessionId: String(session_id || sessionIdField || sessionId),
      title: typeof title === "string" ? title : "Chat",
      closed: Boolean(closed ?? false),
      createdAt: typeof created_at === "string" ? created_at : typeof createdAt === "string" ? createdAt : new Date().toISOString(),
      updatedAt: typeof updated_at === "string" ? updated_at : typeof updatedAt === "string" ? updatedAt : new Date().toISOString(),
      model: typeof model === "string" ? model : "gemini-2.5-flash",
      thinkingLevel: isThinkingLevel(thinking_level) ? thinking_level : "High",
      enabledTools: toStringArray(enabled_tools),
      turnCount: typeof turn_count === "number" ? turn_count : undefined,
      lastPrompt: typeof last_prompt === "string" ? last_prompt : undefined,
    };
  } catch {
    return null;
  }
}

export async function saveSessionMetadata(
  workspaceDir: string,
  metadata: SessionMetadata
): Promise<void> {
  const filePath = getSessionMetadataPath(workspaceDir, metadata.sessionId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const yml = YAML.stringify({
    session_id: metadata.sessionId,
    title: metadata.title,
    closed: metadata.closed,
    created_at: metadata.createdAt,
    updated_at: metadata.updatedAt || new Date().toISOString(),
    model: metadata.model || "gemini-2.5-flash",
    thinking_level: metadata.thinkingLevel || "High",
    enabled_tools: metadata.enabledTools || INITIAL_TOOLS,
    turn_count: metadata.turnCount ?? 0,
    last_prompt: metadata.lastPrompt || "",
  });

  await fs.writeFile(filePath, yml, "utf8");
}

export async function listSessions(workspaceDir: string): Promise<SessionMetadata[]> {
  const sessionsRoot = path.join(workspaceDir, ".atomic", "sessions");
  try {
    const entries = await fs.readdir(sessionsRoot, { withFileTypes: true });
    const dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    const list: SessionMetadata[] = [];
    for (const id of dirNames) {
      const meta = await loadSessionMetadata(workspaceDir, id);
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
    return list.toSorted((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  } catch {
    return [];
  }
}
