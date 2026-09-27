import { describe, it, expect, beforeEach } from "bun:test";
import { createMemoryRuntime, ScriptedShell } from "../src/adapters/memory/runtime";
import {
  resolveDevContainer,
  clearDevContainerCache,
  ensureContainer,
} from "../src/core/devcontainer";

function runtimeWith(
  handler: (args: string[]) => { code: number; stdout: string; stderr: string }
) {
  const runtime = createMemoryRuntime();
  runtime.shell = new ScriptedShell((_, args) => handler(args));
  return runtime;
}

describe("resolveDevContainer", () => {
  beforeEach(() => clearDevContainerCache());

  it("prefers the running container and maps the workspace mount", async () => {
    const runtime = runtimeWith((args) => {
      if (args[0] === "ps") return { code: 0, stdout: "old\texited\nnew\trunning\n", stderr: "" };
      return { code: 0, stdout: args[0] === "inspect" ? "/w\t/workspaces/w\n" : "", stderr: "" };
    });
    expect(await resolveDevContainer(runtime, "/w")).toEqual({
      containerId: "new",
      status: "running",
      workdir: "/workspaces/w",
    });
  });

  it("reports stopped with the stopped container id", async () => {
    const runtime = runtimeWith((args) => ({
      code: 0,
      stdout: args[0] === "ps" ? "old\texited\n" : "",
      stderr: "",
    }));
    expect(await resolveDevContainer(runtime, "/w")).toEqual({
      containerId: "old",
      status: "stopped",
      workdir: null,
    });
  });

  it("reports stopped when only config exists, not_setup otherwise", async () => {
    const runtime = runtimeWith(() => ({ code: 0, stdout: "", stderr: "" }));
    const before = await resolveDevContainer(runtime, "/w");
    expect(before.status).toBe("not_setup");
    clearDevContainerCache();
    runtime.fs.files.set("/w/.devcontainer/devcontainer.json", "{}");
    runtime.fs.dirs.add("/w/.devcontainer");
    const after = await resolveDevContainer(runtime, "/w");
    expect(after.status).toBe("stopped");
  });

  it("returns a null workdir when the root is not bind-mounted", async () => {
    const runtime = runtimeWith((args) => {
      if (args[0] === "ps") return { code: 0, stdout: "c\trunning\n", stderr: "" };
      return { code: 0, stdout: args[0] === "inspect" ? "/elsewhere\t/x\n" : "", stderr: "" };
    });
    const resolved = await resolveDevContainer(runtime, "/w");
    expect(resolved.workdir).toBeNull();
  });
});

describe("ensureContainer", () => {
  beforeEach(() => clearDevContainerCache());

  it("filters by the fallback label when no devcontainer is configured", async () => {
    const runtime = runtimeWith(() => ({ code: 0, stdout: "", stderr: "" }));
    await resolveDevContainer(runtime, "/w");
    expect(runtime.shell.calls[0].args).toContain("label=at.local_folder=/w");
  });

  it("creates a fallback container mounted at the same path and installs bwrap", async () => {
    const runtime = runtimeWith((args) => ({
      code: 0,
      stdout: args[0] === "run" ? "fresh\n" : "",
      stderr: "",
    }));
    await ensureContainer(runtime, "/w");
    const calls = runtime.shell.calls.map((c) => c.args).filter((a) => a[0] !== "ps");
    expect(calls[0].slice(0, 7)).toEqual([
      "run",
      "-d",
      "--label",
      "at.local_folder=/w",
      "-v",
      "/w:/w",
      "-w",
    ]);
    expect(calls[0].slice(-3)).toEqual(["debian:stable-slim", "sleep", "infinity"]);
    expect(calls[1]).toEqual([
      "exec",
      "fresh",
      "sh",
      "-c",
      "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y bubblewrap",
    ]);
  });

  it("starts a stopped container", async () => {
    const runtime = runtimeWith((args) => ({
      code: 0,
      stdout: args[0] === "ps" ? "old\texited\n" : "",
      stderr: "",
    }));
    await ensureContainer(runtime, "/w");
    expect(runtime.shell.calls.map((c) => c.args).filter((a) => a[0] === "start")).toEqual([
      ["start", "old"],
    ]);
  });

  it("throws when a devcontainer is configured but never created", async () => {
    const runtime = runtimeWith(() => ({ code: 0, stdout: "", stderr: "" }));
    runtime.fs.dirs.add("/w/.devcontainer");
    runtime.fs.files.set("/w/.devcontainer/devcontainer.json", "{}");
    await expect(ensureContainer(runtime, "/w")).rejects.toThrow("devcontainer up");
  });

  it("creates only one container under concurrent calls", async () => {
    const runtime = runtimeWith((args) => ({
      code: 0,
      stdout: args[0] === "run" ? "fresh\n" : "",
      stderr: "",
    }));
    await Promise.all([ensureContainer(runtime, "/w"), ensureContainer(runtime, "/w")]);
    expect(runtime.shell.calls.filter((c) => c.args[0] === "run")).toHaveLength(1);
  });

  it("surfaces docker failures", async () => {
    const runtime = runtimeWith((args) =>
      args[0] === "run"
        ? { code: 125, stdout: "", stderr: "no daemon" }
        : { code: 0, stdout: "", stderr: "" }
    );
    await expect(ensureContainer(runtime, "/w")).rejects.toThrow("docker run failed: no daemon");
  });
});
