import { describe, it, expect } from "bun:test";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import {
  DEFAULT_SETTINGS,
  resolveSettings,
  updateSessionSettings,
} from "../src/core/config/settings";
import { loadScopedSettings, saveSettingsLayer } from "../src/core/config/scopedSettings";

const USER = "/appconfig/config.yml";
const REPO_PROJECT = "/w/.allonomic/config.yml";
const REPO_SESSION = "/w/.allonomic/sessions/s1/metadata.yml";

describe("layered config", () => {
  it("writes the defaults to the app config dir when missing", async () => {
    const runtime = createMemoryRuntime();
    expect(await resolveSettings(runtime, "/w")).toEqual(DEFAULT_SETTINGS);
    expect(runtime.fs.files.get(USER)).toContain("execution_mode: restricted");
  });

  it("migrates a legacy sandbox.yml", async () => {
    const runtime = createMemoryRuntime();
    runtime.fs.files.set("/appconfig/sandbox.yml", "sandbox:\n  deny: [/secret]\n");
    const settings = await resolveSettings(runtime, "/w");
    expect(settings.sandbox.deny).toEqual(["/secret"]);
    expect(runtime.fs.files.get(USER)).toContain("/secret");
  });

  it("rejects an invalid user config", async () => {
    const runtime = createMemoryRuntime();
    runtime.fs.files.set(USER, "sandbox:\n  deny: nope\n");
    await expect(resolveSettings(runtime, "/w")).rejects.toThrow("Invalid config");
  });

  it("applies user < project < session from user config", async () => {
    const runtime = createMemoryRuntime();
    runtime.fs.files.set(
      USER,
      [
        "execution_mode: read",
        "model: a",
        "projects:",
        "  /w:",
        "    model: b",
        "    network_access: true",
        "    sandbox:",
        "      2:",
        "        write: [/extra]",
        "    sessions:",
        "      s1:",
        "        model: c",
        "",
      ].join("\n")
    );
    const session = await resolveSettings(runtime, "/w", "s1");
    expect(session).toMatchObject({ executionMode: "read", model: "c", networkAccess: true });
    expect(session.sandbox.tiers[2].write).toContain("/extra");
    expect(session.sandbox.tiers[2].write).toContain("~/.npm");
    const otherSession = await resolveSettings(runtime, "/w", "s2");
    const otherProject = await resolveSettings(runtime, "/other", "s1");
    expect(otherSession.model).toBe("b");
    expect(otherProject.model).toBe("a");
  });

  it("repo files can only tighten", async () => {
    const runtime = createMemoryRuntime();
    runtime.fs.files.set(USER, "execution_mode: write\ngovernor_mode: off\n");
    runtime.fs.files.set(
      REPO_PROJECT,
      [
        "execution_mode: god",
        "network_access: true",
        "governor_mode: intent-only",
        "tools:",
        "  shell_4_full_access: false",
        "  read_file: true",
        "sandbox:",
        "  deny: [$PROJECT/secrets]",
        "  3:",
        "    write: [/]",
        "",
      ].join("\n")
    );
    runtime.fs.files.set(REPO_SESSION, "session_id: s1\nexecution_mode: read\n");
    const settings = await resolveSettings(runtime, "/w", "s1");
    expect(settings.executionMode).toBe("read");
    expect(settings.networkAccess).toBe(false);
    expect(settings.governorMode).toBe("intent-only");
    expect(settings.enabledTools).not.toContain("shell_4_full_access");
    expect(settings.sandbox.deny).toContain("$PROJECT/secrets");
    expect(settings.sandbox.tiers[3].write).not.toContain("/");
  });

  it("repo session metadata cannot turn network on", async () => {
    const runtime = createMemoryRuntime();
    runtime.fs.files.set(REPO_SESSION, "session_id: s1\nnetwork_access: true\n");
    const settings = await resolveSettings(runtime, "/w", "s1");
    expect(settings.networkAccess).toBe(false);
  });

  it("ignores invalid legacy keys in session metadata", async () => {
    const runtime = createMemoryRuntime();
    runtime.fs.files.set(REPO_SESSION, "session_id: s1\nexecution_mode: accept edits\n");
    const settings = await resolveSettings(runtime, "/w", "s1");
    expect(settings.executionMode).toBe("restricted");
  });

  it("saves each scope's layer without touching the others", async () => {
    const runtime = createMemoryRuntime();
    await updateSessionSettings(runtime, "/w", "s1", { model: "c" });
    await saveSettingsLayer(runtime, "/w", "s1", "project", { model: "b" });
    await saveSettingsLayer(runtime, "/w", "s1", "user", { model: "a" });
    const scoped = await loadScopedSettings(runtime, "/w", "s1");
    expect(scoped.layers).toEqual({
      user: { model: "a" },
      project: { model: "b" },
      session: { model: "c" },
    });
    expect(scoped.inherited.project.model).toBe("a");
    expect(scoped.inherited.session.model).toBe("b");
    const resolved = await resolveSettings(runtime, "/w", "s1");
    expect(resolved.model).toBe("c");

    await saveSettingsLayer(runtime, "/w", "s1", "session", {});
    const cleared = await resolveSettings(runtime, "/w", "s1");
    expect(cleared.model).toBe("b");
  });

  it("repo model feeds inherited values but not the user layers", async () => {
    const runtime = createMemoryRuntime();
    runtime.fs.files.set(REPO_PROJECT, "model: repo-model\n");
    const scoped = await loadScopedSettings(runtime, "/w", "s1");
    expect(scoped.repoDefaults.model).toBe("repo-model");
    expect(scoped.inherited.project.model).toBe("repo-model");
    expect(scoped.layers.project.model).toBeUndefined();
  });

  it("tab updates are stored per session in user config", async () => {
    const runtime = createMemoryRuntime();
    const updated = await updateSessionSettings(runtime, "/w", "s1", {
      networkAccess: true,
      tools: { write_file: false },
    });
    expect(updated.networkAccess).toBe(true);
    expect(updated.enabledTools).not.toContain("write_file");
    await updateSessionSettings(runtime, "/w", "s1", { tools: { read_file: false } });
    const again = await resolveSettings(runtime, "/w", "s1");
    expect(again.enabledTools).not.toContain("write_file");
    expect(again.enabledTools).not.toContain("read_file");
    const otherSession = await resolveSettings(runtime, "/w", "s2");
    expect(otherSession.networkAccess).toBe(false);
    expect(runtime.fs.files.has(REPO_SESSION)).toBe(false);
  });

  it("ui interceptor and worker text collapse are per-session settings", async () => {
    const runtime = createMemoryRuntime();
    const defaults = await resolveSettings(runtime, "/w", "s1");
    expect(defaults.uiEnabled).toBe(true);
    expect(defaults.collapseWorkerText).toBe(true);
    await updateSessionSettings(runtime, "/w", "s1", {
      uiEnabled: false,
      collapseWorkerText: false,
    });
    const updated = await resolveSettings(runtime, "/w", "s1");
    expect(updated.uiEnabled).toBe(false);
    expect(updated.collapseWorkerText).toBe(false);
    const otherSession = await resolveSettings(runtime, "/w", "s2");
    expect(otherSession.uiEnabled).toBe(true);
  });
});
