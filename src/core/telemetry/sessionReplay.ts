import type { FileStore } from "../ports";
import { join, basename } from "../paths";
import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import type { GovernorState } from "../governor/types";
import { applyGovernorAction, EMPTY_GOVERNOR_STATE } from "../governor/reducer";
import { loadSessionTurns, nextTurnIndexAfter, turnDirName } from "../turn/turnFiles";
import type { TurnEvent } from "../turn/events";

export interface ResumeResult {
  sessionId: string;
  sessionDir: string;
  governorState: GovernorState;
  messages: BaseMessage[];
  nextTurnIndex: number;
}

function replayGovernor(events: TurnEvent[]): GovernorState {
  let state = EMPTY_GOVERNOR_STATE;
  for (const event of events) {
    if (event.type === "governor_action") state = applyGovernorAction(state, event.action).state;
  }
  return state;
}

function replayMessages(events: TurnEvent[]): BaseMessage[] {
  const messages: BaseMessage[] = [];
  for (const event of events) {
    if (event.type === "turn_started" && event.prompt)
      messages.push(new HumanMessage(event.prompt));
    if (event.type === "turn_completed" && event.finalResponse)
      messages.push(new AIMessage(event.finalResponse));
  }
  return messages;
}

async function copyDirRecursive(fs: FileStore, src: string, dst: string) {
  await fs.mkdir(dst);
  const entries = await fs.readDir(src);
  for (const e of entries) {
    const srcPath = join(src, e.name);
    const dstPath = join(dst, e.name);
    await (e.isDirectory ? copyDirRecursive(fs, srcPath, dstPath) : fs.copyFile(srcPath, dstPath));
  }
}

function rethrow(turnIndex: number, error: unknown): never {
  throw new Error(
    `Failed to load turn ${turnIndex}: ${error instanceof Error ? error.message : String(error)}`,
    { cause: error }
  );
}

/**
 * Replays turns from sourceDir up to upToTurn, rebuilding GovernorState
 * deterministically from persisted events (zero LLM calls).
 * If newDir is provided, forks the turns into the new directory.
 */
export async function resumeFromDir(
  fs: FileStore,
  sourceDir: string,
  newDir?: string,
  upToTurn?: number
): Promise<ResumeResult> {
  const { turnNumbers, events } = await loadSessionTurns(fs, sourceDir, rethrow, upToTurn);

  if (newDir) {
    await fs.mkdir(join(newDir, "turns"));
    for (const turnIndex of turnNumbers) {
      const name = turnDirName(turnIndex);
      await copyDirRecursive(fs, join(sourceDir, "turns", name), join(newDir, "turns", name));
    }
  }

  const sessionDir = newDir ?? sourceDir;
  return {
    sessionId: basename(sessionDir),
    sessionDir,
    governorState: replayGovernor(events),
    messages: replayMessages(events),
    nextTurnIndex: nextTurnIndexAfter(turnNumbers),
  };
}
