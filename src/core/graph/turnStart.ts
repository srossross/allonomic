import { USER_ACTOR, type ContextFile, type TurnEventSink } from "../turn/events";
import type { SettingsRecorder } from "./settingsRecorder";

export async function beginTurn(
  sink: TurnEventSink,
  settings: SettingsRecorder,
  turn: { threadId: string; prompt: string | null; contextFiles: ContextFile[] }
): Promise<void> {
  const user = sink.scope(USER_ACTOR);
  try {
    await settings.record(user);
    user.emit({ type: "turn_started", threadId: turn.threadId, prompt: turn.prompt });
  } finally {
    user.close();
  }
  if (turn.contextFiles.length > 0)
    sink.emit({
      type: "context_files_loaded",
      agent: "worker",
      hook: "session",
      files: turn.contextFiles,
    });
}
