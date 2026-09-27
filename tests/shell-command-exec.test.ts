import { describe, it, expect, beforeEach } from "bun:test";
import { createMemoryRuntime, ScriptedShell } from "../src/adapters/memory/runtime";
import { createAgentTools } from "../src/core/tools";
import { clearDevContainerCache } from "../src/core/devcontainer";

const PS_ROW = "cid123\trunning\n";
const MOUNTS = "/a/b/c\t/workspaces/c\n/var/lib/docker/volumes/x/_data\t/var/lib/docker\n";

function shellTools(
  mode: "manual" | "accept edits",
  isApproved?: boolean,
  workspaceDir = "/a/b/c"
) {
  const runtime = createMemoryRuntime();
  runtime.fs.dirs.add("/a/b/c/.devcontainer");
  const shell = new ScriptedShell((program, args) => {
    if (args[0] === "ps") return { code: 0, stdout: PS_ROW, stderr: "" };
    return { code: 0, stdout: args[0] === "inspect" ? MOUNTS : "", stderr: "" };
  });
  runtime.shell = shell;
  const tools = createAgentTools(runtime, workspaceDir, mode, { approved: isApproved });
  return {
    shell,
    readOnly: tools.find((t) => t.name === "run_read_only_command")!,
    mutate: tools.find((t) => t.name === "run_mutating_command")!,
  };
}

const execCalls = (shell: ScriptedShell) => shell.calls.filter((c) => c.args[0] === "exec");

describe("shell command execution", () => {
  beforeEach(() => clearDevContainerCache());

  it("mutating passes the raw command to sh -c with the container mount as workdir", async () => {
    const { shell, mutate } = shellTools("accept edits", true);
    await mutate.invoke({ command: "go mod tidy" });
    expect(execCalls(shell)[0].args).toEqual([
      "exec",
      "-w",
      "/workspaces/c",
      "cid123",
      "sh",
      "-c",
      "go mod tidy",
    ]);
  });

  it("read-only wraps in bwrap, binds the container workdir read-only, and runs there", async () => {
    const { shell, readOnly } = shellTools("accept edits", true);
    await readOnly.invoke({ command: "ls -la" });
    expect(execCalls(shell)[0].args).toEqual([
      "exec",
      "-w",
      "/workspaces/c",
      "cid123",
      "bwrap",
      "--bind",
      "/",
      "/",
      "--dev-bind",
      "/dev",
      "/dev",
      "--ro-bind",
      "/workspaces/c",
      "/workspaces/c",
      "sh",
      "-c",
      "ls -la",
    ]);
  });

  it("maps a workspace below the devcontainer root onto the mount", async () => {
    const { shell, mutate } = shellTools("accept edits", true, "/a/b/c/sub/dir");
    await mutate.invoke({ command: "pwd" });
    expect(execCalls(shell)[0].args.slice(0, 3)).toEqual(["exec", "-w", "/workspaces/c/sub/dir"]);
  });

  it("caches the container lookup across commands", async () => {
    const { shell, mutate } = shellTools("accept edits", true);
    await mutate.invoke({ command: "a" });
    await mutate.invoke({ command: "b" });
    expect(shell.calls.filter((c) => c.args[0] === "ps")).toHaveLength(1);
    expect(shell.calls.filter((c) => c.args[0] === "inspect")).toHaveLength(1);
    expect(execCalls(shell)).toHaveLength(2);
  });

  it("re-resolves and retries once when the cached container is gone", async () => {
    const runtime = createMemoryRuntime();
    runtime.fs.dirs.add("/a/b/c/.devcontainer");
    let psCalls = 0;
    const shell = new ScriptedShell((_, args) => {
      if (args[0] === "ps") return { code: 0, stdout: `cid${++psCalls}\trunning\n`, stderr: "" };
      if (args[0] === "inspect") return { code: 0, stdout: MOUNTS, stderr: "" };
      return args[0] === "exec" && args[3] === "cid1"
        ? { code: 1, stdout: "", stderr: "Error response from daemon: No such container: cid1" }
        : { code: 0, stdout: "ok", stderr: "" };
    });
    runtime.shell = shell;
    const mutate = createAgentTools(runtime, "/a/b/c", "accept edits", { approved: true }).find(
      (t) => t.name === "run_mutating_command"
    )!;
    const result = await mutate.invoke({ command: "x" });
    expect(result).toBe("ok");
    expect(execCalls(shell).map((c) => c.args[3])).toEqual(["cid1", "cid2"]);
  });

  it("creates a fallback container and runs at the host path when no devcontainer exists", async () => {
    const runtime = createMemoryRuntime();
    let isCreated = false;
    const shell = new ScriptedShell((_, args) => {
      if (args[0] === "ps")
        return { code: 0, stdout: isCreated ? "fb1\trunning\n" : "", stderr: "" };
      if (args[0] === "run") {
        isCreated = true;
        return { code: 0, stdout: "fb1\n", stderr: "" };
      }
      return { code: 0, stdout: args[0] === "inspect" ? "/a/b/c\t/a/b/c\n" : "ok", stderr: "" };
    });
    runtime.shell = shell;
    const mutate = createAgentTools(runtime, "/a/b/c", "accept edits", { approved: true }).find(
      (t) => t.name === "run_mutating_command"
    )!;
    expect(await mutate.invoke({ command: "x" })).toBe("ok");
    expect(execCalls(shell).at(-1)!.args).toEqual(["exec", "-w", "/a/b/c", "fb1", "sh", "-c", "x"]);
  });

  it("refuses when a devcontainer is configured but not created", async () => {
    const runtime = createMemoryRuntime();
    runtime.fs.dirs.add("/a/b/c/.devcontainer");
    runtime.fs.files.set("/a/b/c/.devcontainer/devcontainer.json", "{}");
    const shell = new ScriptedShell(() => ({ code: 0, stdout: "", stderr: "" }));
    runtime.shell = shell;
    const mutate = createAgentTools(runtime, "/a/b/c", "accept edits", { approved: true }).find(
      (t) => t.name === "run_mutating_command"
    )!;
    const result = await mutate.invoke({ command: "x" });
    expect(result).toContain("devcontainer up");
    expect(execCalls(shell)).toHaveLength(0);
  });

  it("manual mode returns a pending confirm without executing", async () => {
    const { shell, mutate } = shellTools("manual");
    const result = await mutate.invoke({ command: "go mod tidy" });
    expect(JSON.parse(result).pending).toBe(true);
    expect(execCalls(shell)).toHaveLength(0);
  });
});
