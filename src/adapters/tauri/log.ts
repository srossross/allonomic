import { attachConsole, debug, error, info, trace, warn } from "@tauri-apps/plugin-log";
import { createLogger, formatRecord, levelName, setAppSink, type LogLevel } from "@/core/log";

const log = createLogger("app.lifecycle");

const sinks: Record<LogLevel, (message: string) => Promise<void>> = {
  trace,
  debug,
  info,
  warn,
  error,
  fatal: error,
};

export async function initLogging(): Promise<void> {
  setAppSink((record) => {
    void (async () => {
      try {
        await sinks[levelName(record.level)](formatRecord(record));
      } catch (error_) {
        console.error("[log] sink failed:", error_);
      }
    })();
  });
  logLifecycle();
  await attachConsole();
}

function logLifecycle(): void {
  log.info({ href: location.href }, "webview boot");
  globalThis.addEventListener("pagehide", (event) =>
    log.warn({ persisted: event.persisted }, "webview pagehide")
  );
  globalThis.addEventListener("beforeunload", () => log.warn("webview beforeunload"));
  globalThis.addEventListener("error", (event) =>
    log.error(
      { error: String(event.error ?? event.message), file: event.filename, line: event.lineno },
      "uncaught error"
    )
  );
  globalThis.addEventListener("unhandledrejection", (event) =>
    log.error({ reason: String(event.reason) }, "unhandled rejection")
  );
  document.addEventListener("visibilitychange", () =>
    log.debug({ state: document.visibilityState }, "visibility change")
  );
  import.meta.hot?.on("vite:beforeFullReload", (payload: { path?: string }) =>
    log.warn({ path: payload.path }, "vite full reload")
  );
}
