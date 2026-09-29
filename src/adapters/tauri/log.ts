import { attachConsole, debug, error, info, warn } from "@tauri-apps/plugin-log";
import { setLogSink, type LogLevel } from "@/core/log";

const sinks: Record<LogLevel, (message: string) => Promise<void>> = { debug, info, warn, error };

export async function initLogging(): Promise<void> {
  setLogSink((level, message) => {
    void (async () => {
      try {
        await sinks[level](message);
      } catch (error) {
        console.error("[log] sink failed:", error);
      }
    })();
  });
  await attachConsole();
}
