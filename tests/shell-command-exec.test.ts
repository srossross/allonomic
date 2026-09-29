import { describe, it, expect } from "bun:test";
import { createMemoryRuntime, ScriptedShell } from "../src/adapters/memory/runtime";
import type { ShellResult } from "../src/core/ports";
import { createAgentTools } from "../src/core/tools";
import { seatbeltProfile } from "../src/core/tools/shell";
import { parseShellResult } from "../src/core/tools/shellResult";

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
    shell: runtime.shell,
    level1: byName("shell_1_project_read_only"),
    level2: byName("shell_2_read_only"),
    level3: byName("shell_3_project_write"),
    level4: byName("shell_4_full_access"),
  };
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
    expect(args.slice(-3)).toEqual(["/w", tmp, "ls -la"]);
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
    expect(shell.calls[0]).toEqual({
      program: "sh",
      args: ["-c", 'cd "$0" && exec /bin/sh -c "$1"', "/w", "make"],
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
