import type { FileStore } from "../ports";
import { join } from "../paths";
import { createLogger } from "../log";
import { turnEventSchema, type TurnEvent } from "./events";

const log = createLogger("turn.files");
const SEGMENT_PATTERN = /^(\d+)-.+\.jsonl$/;

export function turnDirName(turnIndex: number): string {
  return String(turnIndex).padStart(3, "0");
}

export function turnDirFor(sessionDir: string, turnIndex: number): string {
  return join(sessionDir, "turns", turnDirName(turnIndex));
}

export function segmentFileName(position: number, actor: string): string {
  return `${String(position).padStart(3, "0")}-${actor.toLowerCase()}.jsonl`;
}

export async function appendSegmentEvents(
  fs: FileStore,
  path: string,
  events: TurnEvent[]
): Promise<void> {
  const lines = events.map((event) => `${JSON.stringify(event)}\n`).join("");
  await fs.writeText(path, lines, { append: true });
}

export interface SegmentFile {
  name: string;
  position: number;
}

export async function listSegmentFiles(fs: FileStore, turnDir: string): Promise<SegmentFile[]> {
  const entries = await fs.readDir(turnDir);
  return entries
    .flatMap((entry) => {
      const match = entry.isDirectory ? null : SEGMENT_PATTERN.exec(entry.name);
      return match ? [{ name: entry.name, position: Number(match[1]) }] : [];
    })
    .toSorted((a, b) => a.position - b.position);
}

function parseSegment(text: string, path: string, isLastSegment: boolean): TurnEvent[] {
  const lines = text.split("\n").filter((line) => line.trim());
  return lines.flatMap((line, index) => {
    try {
      return [turnEventSchema.parse(JSON.parse(line))];
    } catch (error) {
      if (isLastSegment && index === lines.length - 1) {
        log.warn({ path, line: index + 1 }, "dropping torn final line");
        return [];
      }
      throw new Error(`${path} line ${index + 1}: ${String(error)}`, { cause: error });
    }
  });
}

export async function loadTurn(
  fs: FileStore,
  turnDir: string,
  beforePosition = Infinity
): Promise<TurnEvent[]> {
  const segmentFiles = await listSegmentFiles(fs, turnDir);
  const files = segmentFiles
    .filter((segment) => segment.position < beforePosition)
    .map((segment) => segment.name);
  if (files.length === 0) throw new Error(`${turnDir} has no event segments`);
  const segments = await Promise.all(
    files.map(async (name, index) => {
      const path = join(turnDir, name);
      return parseSegment(await fs.readText(path), path, index === files.length - 1);
    })
  );
  return segments.flat().toSorted((a, b) => a.seq - b.seq);
}

export async function appendTurnEvent(
  fs: FileStore,
  sessionDir: string,
  event: TurnEvent
): Promise<void> {
  const turnDir = turnDirFor(sessionDir, event.turnIndex);
  const files = await listSegmentFiles(fs, turnDir);
  const last = files.at(-1);
  if (!last) throw new Error(`${turnDir} has no event segments`);
  await appendSegmentEvents(fs, join(turnDir, last.name), [event]);
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
  for (const turnIndex of turnNumbers) {
    try {
      events.push(...(await loadTurn(fs, turnDirFor(sessionDir, turnIndex))));
    } catch (error) {
      onTurnError(turnIndex, error);
    }
  }
  return { turnNumbers, events };
}

export function nextTurnIndexAfter(turnNumbers: number[]): number {
  return (turnNumbers.at(-1) ?? 0) + 1;
}
