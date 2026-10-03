import { changedSettings, resolveSettings, type Settings } from "../config/settings";
import type { Runtime } from "../ports";
import { USER_ACTOR, type TurnEventSink } from "../turn/events";

export class SettingsRecorder {
  private snapshot: Settings | undefined;

  constructor(
    private readonly runtime: Runtime,
    private readonly workspaceDir: string,
    private readonly sessionId: string
  ) {}

  async record(sink: TurnEventSink) {
    const next = await resolveSettings(this.runtime, this.workspaceDir, this.sessionId);
    const changes = changedSettings(this.snapshot, next);
    this.snapshot = next;
    if (Object.keys(changes).length > 0) sink.emit({ type: "settings_changed", changes });
  }

  inUserScope(sink: TurnEventSink): () => Promise<void> {
    return async () => {
      const user = sink.scope(USER_ACTOR);
      try {
        await this.record(user);
      } finally {
        user.close();
      }
    };
  }
}
