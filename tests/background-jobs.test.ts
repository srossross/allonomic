import { describe, it, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createMemoryRuntime,
  MemoryFileStore,
  ScriptedShell,
} from "../src/adapters/memory/runtime";
import { createNodeRuntime } from "../src/adapters/node/runtime";
import {
  BackgroundJobs,
  JOB_OUTPUT_LIMIT,
  type JobSpec,
  type JobStore,
} from "../src/core/jobs/backgroundJobs";
import { GROUP_WRAPPER, PARENT_WATCHDOG, PGID_MARKER } from "../src/core/superviseProcess";
import { createAgentTools } from "../src/core/tools";

const SPEC: JobSpec = { command: "serve", level: 4, toolName: "shell_4_full_access" };
const launch = async () => ({ program: "sh", args: ["-c", "serve"], cwd: "/w", logDir: "/logs" });

function memoryStore(initial: JobSpec[] = []): JobStore & { saved: JobSpec[][] } {
  const saved: JobSpec[][] = [];
  return { saved, load: async () => initial, save: async (specs) => void saved.push(specs) };
}

function scripted(store?: JobStore) {
  const shell = new ScriptedShell(undefined, false);
  const fs = new MemoryFileStore();
  const jobs = new BackgroundJobs(shell, fs, launch, store);
  const process = (index = 0) => shell.spawned[index].process;
  return { shell, fs, jobs, process };
}

describe("BackgroundJobs", () => {
  it("streams output to the UI buffer and the log file, and waits for a pattern", async () => {
    const { shell, fs, jobs, process } = scripted();
    const { id, logPath } = await jobs.start(SPEC);
    expect(logPath).toBe("/logs/job-1.log");
    expect(shell.spawned[0]).toMatchObject({ program: "sh", args: ["-c", "serve"] });
    const waiting = jobs.waitFor(id, /ready/, 1000);
    process().emit("stdout", "booting\n");
    process().emit("stderr", "ready on 8099\n");
    expect(await waiting).toBe("matched");
    await jobs.flushLog(id);
    expect(jobs.read(id)?.output).toBe("booting\nready on 8099\n");
    expect(await fs.readText(logPath)).toBe("booting\nready on 8099\n");
  });

  it("caps the UI buffer but keeps the full log", async () => {
    const { fs, jobs, process } = scripted();
    const { id, logPath } = await jobs.start(SPEC);
    process().emit("stdout", "a".repeat(JOB_OUTPUT_LIMIT));
    process().emit("stdout", "tail");
    await jobs.flushLog(id);
    const { output } = jobs.read(id)!;
    expect(output.length).toBe(JOB_OUTPUT_LIMIT);
    expect(output.endsWith("tail")).toBe(true);
    const log = await fs.readText(logPath);
    expect(log.length).toBe(JOB_OUTPUT_LIMIT + 4);
  });

  it("kills, reports killed and drops the job from the store", async () => {
    const store = memoryStore();
    const { jobs, process } = scripted(store);
    const { id } = await jobs.start(SPEC);
    expect(store.saved.at(-1)).toEqual([SPEC]);
    expect(await jobs.kill(id)).toBe(true);
    await Bun.sleep(0);
    expect(process().signals).toEqual(["SIGTERM"]);
    expect(jobs.read(id)?.info).toMatchObject({ status: "killed", exitCode: null });
    expect(store.saved.at(-1)).toEqual([]);
    expect(await jobs.kill(id)).toBe(false);
  });

  it("restores interrupted jobs and restarts only the selected ones", async () => {
    const other: JobSpec = { command: "watch", level: 2, toolName: "shell_2_read_only" };
    const store = memoryStore([SPEC, other]);
    const { jobs } = scripted(store);
    await jobs.restore();
    expect(jobs.snapshot().interrupted).toEqual([SPEC, other]);
    const started = await jobs.restartInterrupted([1]);
    expect(started.map((job) => job.command)).toEqual(["watch"]);
    expect(jobs.snapshot().interrupted).toEqual([]);
    expect(store.saved.at(-1)).toEqual([other]);
  });

  it("keeps interrupted jobs in the store until the user decides", async () => {
    const store = memoryStore([SPEC]);
    const { jobs } = scripted(store);
    await jobs.start({ ...SPEC, command: "new" });
    expect(store.saved.at(-1)?.map((spec) => spec.command)).toEqual(["serve", "new"]);
    await jobs.dismissInterrupted();
    expect(store.saved.at(-1)?.map((spec) => spec.command)).toEqual(["new"]);
  });
});

describe("background shell tool", () => {
  it("starts a job, returns startup output, reads later output, and kills it", async () => {
    const runtime = createMemoryRuntime();
    const shell = new ScriptedShell(undefined, false);
    runtime.shell = shell;
    const tools = createAgentTools(runtime, "/w", "god");
    expect(tools.map((t) => t.name)).not.toContain("shell_job_output");
    const level4 = tools.find((t) => t.name === "shell_4_full_access")!;
    const pending = level4.invoke({
      command: "serve",
      background: true,
      background_startup_ms: 50,
    });
    await Bun.sleep(10);
    shell.spawned[0].process.emit("stdout", "booting\n");
    const result = String(await pending);
    const logPath = /output in (\S+)\]/.exec(result)?.[1];
    expect(logPath).toMatch(/^\/private\/tmp\/at-sandbox\/[0-9a-f]{8}\/jobs\/default\/job-1\.log$/);
    expect(result).toBe(
      `Started background job job-1.\nbooting\n[job-1 running; output in ${logPath}]`
    );

    shell.spawned[0].process.emit("stdout", "ready\n");
    const read = tools.find((t) => t.name === "read_shell")!;
    expect(await read.invoke({ call_id: "job-1" })).toBe(
      `booting\nready\n[job-1 running; output in ${logPath}]`
    );
    expect(await read.invoke({ call_id: "local-1", lines: "2" })).toBe("L2: ready");

    const kill = tools.find((t) => t.name === "shell_job_kill")!;
    expect(await kill.invoke({ job_id: "job-1" })).toBe(`[job-1 killed; output in ${logPath}]`);
    expect(await kill.invoke({ job_id: "nope" })).toBe("Error: no background job nope");
  });
});

describe("node background jobs", () => {
  it("writes a real job's output to its log and kills the whole process group", async () => {
    const runtime = createNodeRuntime();
    const logDir = mkdtempSync(path.join(tmpdir(), "jobs-"));
    const jobs = new BackgroundJobs(runtime.shell, runtime.fs, async () => ({
      program: "sh",
      args: ["-c", "echo ready; echo $$; echo oops >&2; sleep 30 & wait"],
      cwd: ".",
      logDir,
    }));
    const { id, logPath } = await jobs.start(SPEC);
    expect(await jobs.waitFor(id, /oops/, 2000)).toBe("matched");
    const pid = Number(jobs.read(id)!.output.split("\n", 2)[1]);
    await jobs.kill(id);
    await jobs.flushLog(id);
    expect(jobs.read(id)?.info.status).toBe("killed");
    expect(() => process.kill(-pid, 0)).toThrow();
    expect(readFileSync(logPath, "utf8")).toContain("ready\n");
    expect(readFileSync(logPath, "utf8")).toContain("oops\n");
  });

  it("watchdog kills the group when its parent dies", () => {
    const script = `
      set -m
      sleep 30 & g=$!
      sh -c 'sh -c "$1" "$2"; exec sleep 30' mid "$WATCHDOG" "$g" & mid=$!
      sleep 0.3
      kill "$mid"
      sleep 1.5
      if kill -0 -- "-$g" 2>/dev/null; then echo alive; kill -- "-$g"; else echo dead; fi
    `;
    const output = execFileSync("/bin/sh", ["-c", script], {
      env: { ...process.env, WATCHDOG: PARENT_WATCHDOG },
      encoding: "utf8",
    });
    expect(output.trim()).toBe("dead");
  });

  it("group wrapper reports the job group, keeps stderr clean, and dies with its parent", () => {
    const script = `
      sh -c 'sh -c "$1" sh sh -c "echo out; echo err >&2; sleep 30 & exit 3" 2>"$2"; echo "exit=$?"; exec sleep 30' mid "$WRAPPER" "$ERR" & mid=$!
      sleep 0.5
      g=$(sed -n "s/^$MARKER//p" "$ERR")
      kill -0 -- "-$g" && echo alive
      kill "$mid"
      sleep 1.5
      if kill -0 -- "-$g" 2>/dev/null; then echo alive; kill -- "-$g"; else echo dead; fi
      grep -v "$MARKER" "$ERR"
    `;
    const output = execFileSync("/bin/sh", ["-c", script], {
      env: {
        ...process.env,
        WRAPPER: GROUP_WRAPPER,
        MARKER: PGID_MARKER,
        ERR: `${process.env.TMPDIR ?? "/tmp"}/wrapper-${process.pid}.err`,
      },
      encoding: "utf8",
    });
    expect(output.split("\n")).toEqual(["out", "exit=3", "alive", "dead", "err", ""]);
  });
});
