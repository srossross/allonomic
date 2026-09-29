import YAML from "yaml";
import type { FileStore } from "../ports";
import { join } from "../paths";
import { TURN_EVENTS_FILE, turnEventFileSchema, type TurnEvent } from "./events";
import { loadLegacyTurn, type LoadedTurn } from "./legacyTurnFiles";

export async function loadTurn(
  fs: FileStore,
  turnDir: string,
  turnIndex: number,
  previousMessageCount: number
): Promise<LoadedTurn> {
  const eventsPath = join(turnDir, TURN_EVENTS_FILE);
  if (!(await fs.exists(eventsPath)))
    return await loadLegacyTurn(fs, turnDir, turnIndex, previousMessageCount);
  const { events } = turnEventFileSchema.parse(YAML.parse(await fs.readText(eventsPath)));
  return { events, messageCount: previousMessageCount };
}

async function listTurnNumbers(fs: FileStore, sessionDir: string): Promise<number[]> {
  const turnsDir = join(sessionDir, "turns");
  if (!(await fs.exists(turnsDir))) return [];
  const entries = await fs.readDir(turnsDir);
  return entries
    .filter((e) => e.isDirectory && /^\d+$/.test(e.name))
    .map((e) => Number(e.name))
    .toSorted((a, b) => a - b);
}

export function turnDirName(turnIndex: number): string {
  return String(turnIndex).padStart(3, "0");
}

export interface SessionTurns {
  turnNumbers: number[];
  events: TurnEvent[];
}

export async function loadSessionTurns(
  fs: FileStore,
  sessionDir: string,
  onTurnError: (turnIndex: number, error: unknown) => void,
  upToTurn?: number
): Promise<SessionTurns> {
  const all = await listTurnNumbers(fs, sessionDir);
  const turnNumbers = upToTurn === undefined ? all : all.filter((n) => n <= upToTurn);
  const events: TurnEvent[] = [];
  let previousMessageCount = 0;
  for (const turnIndex of turnNumbers) {
    try {
      const loaded = await loadTurn(
        fs,
        join(sessionDir, "turns", turnDirName(turnIndex)),
        turnIndex,
        previousMessageCount
      );
      events.push(...loaded.events);
      previousMessageCount = loaded.messageCount;
    } catch (error) {
      onTurnError(turnIndex, error);
    }
  }
  return { turnNumbers, events };
}

export function nextTurnIndexAfter(turnNumbers: number[]): number {
  return (turnNumbers.at(-1) ?? 0) + 1;
}
