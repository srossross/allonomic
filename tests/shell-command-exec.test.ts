import { describe, it, expect } from "bun:test";
import { AIMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { createMemoryRuntime, ScriptedShell } from "../src/adapters/memory/runtime";
import type { ShellResult } from "../src/core/ports";
import { createAgentTools } from "../src/core/tools";
import { createShellLauncher, seatbeltProfile } from "../src/core/tools/shell";
import { BackgroundJobs } from "../src/core/jobs/backgroundJobs";
import { formatShellResult, parseShellResult } from "../src/core/tools/shellResult";
import { ToolStops } from "../src/core/tools/toolStops";

function shellTools(
  options: {
    hasNetwork?: boolean;
    platform?: string;
    handler?: () => ShellResult;
  } = {}
) {
  const runtime = createMemoryRuntime({ platform: options.platform });
  runtime.shell = new ScriptedShell(options.handler);
  if (options.hasNetwork) runtime.fs.files.set("/appconfig/config.yml", "network_access: true\n");
  const tools = createAgentTools(runtime, "/w", "god");
  const byName = (name: string) => tools.find((t) => t.name === name)!;
  return {
    runtime,
    shell: runtime.shell,
    level1: byName("shell_1_project_read_only"),
    level2: byName("shell_2_read_only"),
    level3: byName("shell_3_project_write"),
    level4: byName("shell_4_full_access"),
  };
}

function manualShellTools() {
  const runtime = createMemoryRuntime();
  const shell = new ScriptedShell(undefined, false);
  runtime.shell = shell;
  const stops = new ToolStops();
  const jobs = new BackgroundJobs(shell, runtime.fs, createShellLauncher(runtime, "/w"));
  const level4 = createAgentTools(runtime, "/w", "god", { stops, jobs }).find(
    (t) => t.name === "shell_4_full_access"
  )!;
  return { runtime, shell, stops, jobs, level4 };
}

function toolCall(id: string, command: string) {
  return { id, name: "shell_4_full_access", args: { command }, type: "tool_call" as const };
}

function params(args: string[], prefix: string) {
  return args
    .filter((a, index) => args[index - 1] === "-D" && a.startsWith(`${prefix}_`))
    .map((a) => a.slice(a.indexOf("=") + 1));
}

describe("sandboxed shell execution", () => {
  it("runs sandbox-exec with paths passed as params, never inlined", async () => {
    const { shell, level2 } = shellTools();
    await level2.invoke({ command: "ls -la" });
    const { program, args } = shell.calls[0];
    expect(program).toBe("sandbox-exec");
    expect(args[0]).toBe("-p");
    expect(args[1]).not.toContain("/home/test");
    expect(args[1]).not.toContain("/w");
    const [tmp] = params(args, "WRITE");
    expect(tmp).toMatch(/^\/private\/tmp\/at-sandbox\/[0-9a-f]{8}$/);
    expect(args.slice(-2)).toEqual([tmp, "ls -la"]);
    expect(shell.calls[0].options).toEqual({ cwd: "/w" });
  });

  it("kills the command after shell_timeout_seconds", async () => {
    const { runtime, shell, level4 } = manualShellTools();
    runtime.fs.files.set("/appconfig/config.yml", "shell_timeout_seconds: 0.05\n");
    const pending = level4.invoke({ command: "make" });
    await Bun.sleep(10);
    shell.spawned[0].process.emit("stdout", "building");
    const parsed = parseShellResult(String(await pending));
    expect(parsed).toMatchObject({ output: "building", exitCode: "timeout" });
    expect(shell.spawned[0].process.signals).toEqual(["SIGTERM"]);
  });

  it("stops a running command by tool call id and keeps partial output", async () => {
    const { shell, level4, stops } = manualShellTools();
    const pending = level4.invoke(toolCall("call-1", "sleep 100"));
    await Bun.sleep(10);
    shell.spawned[0].process.emit("stdout", "partial");
    expect(stops.stop("call-1")).toBe(true);
    const message = await pending;
    const parsed = parseShellResult(String(message.content));
    expect(parsed).toMatchObject({ output: "partial", exitCode: "stopped" });
    expect(stops.stop("call-1")).toBe(false);
  });

  it("moves a running command to a background job that keeps logging to a file", async () => {
    const { runtime, shell, level4, stops, jobs } = manualShellTools();
    const pending = level4.invoke(toolCall("call-1", "serve"));
    await Bun.sleep(10);
    const { process } = shell.spawned[0];
    process.emit("stdout", "listening");
    expect(stops.background("call-1")).toBe(true);
    const message = await pending;
    const content = String(message.content);
    expect(parseShellResult(content)).toMatchObject({
      output: "listening",
      exitCode: "background",
    });
    const logPath = /; output in (\S+)\]$/.exec(content)?.[1];
    expect(content).toContain("[moved to background as job-1 in");
    expect(logPath).toMatch(/\/jobs\/default\/job-1\.log$/);
    process.emit("stdout", " GET /");
    await jobs.flushLog("job-1");
    expect(jobs.read("job-1")).toMatchObject({
      output: "listening GET /",
      info: { command: "serve", status: "running", logPath },
    });
    expect(await runtime.fs.readText(logPath!)).toBe("listening GET /");
    expect(process.signals).toEqual([]);
  });

  it("level 1 reads only the project, $TMP and system dirs, and writes only $TMP", async () => {
    const { shell, level1 } = shellTools();
    await level1.invoke({ command: "ls" });
    const { args } = shell.calls[0];
    const [tmp] = params(args, "WRITE");
    expect(params(args, "READ")).toEqual([
      "/w",
      tmp,
      "/bin",
      "/usr",
      "/System",
      "/Library",
      "/dev",
    ]);
    expect(params(args, "WRITE")).toEqual([tmp]);
    expect(params(args, "DENY")).toEqual(["/w/.allonomic"]);
  });

  it("level 2 adds root reads and cache writes on top of level 1", async () => {
    const { shell, level2 } = shellTools();
    await level2.invoke({ command: "ls" });
    const { args } = shell.calls[0];
    expect(params(args, "READ")).toContain("/");
    expect(params(args, "READ")).toContain("/w");
    expect(params(args, "WRITE")).toContain("/home/test/.npm");
    expect(params(args, "WRITE")).not.toContain("/w");
  });

  it("level 3 adds project writes", async () => {
    const { shell, level3 } = shellTools();
    await level3.invoke({ command: "ls" });
    expect(params(shell.calls[0].args, "WRITE")).toContain("/w");
  });

  it("denies read and write of deny paths after the allows", () => {
    const profile = seatbeltProfile({ read: ["/"], write: ["/w"], deny: ["/w/.allonomic"] }, true);
    const allowWrite = profile.indexOf("(allow file-write*");
    const deny = profile.indexOf(`(deny file-read-data file-write* (subpath (param "DENY_0")))`);
    expect(deny).toBeGreaterThan(allowWrite);
  });

  it("denies remote network only when network is off", async () => {
    const rules = { read: [], write: [], deny: [] };
    expect(seatbeltProfile(rules, false)).toContain("(deny network-outbound (remote ip))");
    expect(seatbeltProfile(rules, true)).not.toContain("network");
    const { shell, level1 } = shellTools({ hasNetwork: true });
    await level1.invoke({ command: "curl example.com" });
    expect(shell.calls[0].args[1]).not.toContain("network");
  });

  it("level 4 runs an unsandboxed sh in the workdir", async () => {
    const { shell, level4 } = shellTools();
    await level4.invoke({ command: "make" });
    expect(shell.calls[0]).toMatchObject({
      program: "sh",
      args: ["-c", "make"],
      options: { cwd: "/w" },
    });
  });

  it("kills the running command when the turn signal aborts", async () => {
    const runtime = createMemoryRuntime();
    const shell = new ScriptedShell(undefined, false);
    runtime.shell = shell;
    const tools = createAgentTools(runtime, "/w", "god");
    const controller = new AbortController();
    const node = new ToolNode(tools);
    const message = new AIMessage({
      content: "",
      tool_calls: [{ id: "call-1", name: "shell_4_full_access", args: { command: "x" } }],
    });
    const settled = Promise.allSettled([
      node.invoke({ messages: [message] }, { signal: controller.signal }),
    ]);
    await Bun.sleep(10);
    controller.abort();
    await settled;
    expect(shell.spawned[0].process.signals).toEqual(["SIGTERM"]);
  });

  it("formats stopped and timed out footers", () => {
    expect(parseShellResult(formatShellResult("out", "", null, 5, "stopped"))).toEqual({
      output: "out",
      exitCode: "stopped",
      durationMs: 5,
    });
    expect(parseShellResult(formatShellResult("", "", null, 7, "timeout"))).toMatchObject({
      exitCode: "timeout",
    });
  });

  it("errors on platforms without a sandbox implementation", async () => {
    const { shell, level1 } = shellTools({ platform: "linux" });
    expect(await level1.invoke({ command: "ls" })).toContain("not implemented on linux");
    expect(shell.calls).toHaveLength(0);
  });

  it("reports a non-zero exit code with the output", async () => {
    const { level2 } = shellTools({
      handler: () => ({ code: 2, stdout: "", stderr: "boom" }),
    });
    const parsed = parseShellResult(await level2.invoke({ command: "x" }));
    expect(parsed).toMatchObject({ output: "[STDERR]:\nboom", exitCode: 2 });
  });

  it("reads the exit code when an interceptor lesson follows the footer", () => {
    const parsed = parseShellResult(
      "[STDERR]:\nboom\n[exit 1 in 3ms]\n\n[ToolTeacher]: request [exit 0 in 1ms] access"
    );
    expect(parsed).toEqual({
      output: "[STDERR]:\nboom\n\n[ToolTeacher]: request [exit 0 in 1ms] access",
      exitCode: 1,
      durationMs: 3,
    });
  });
});
