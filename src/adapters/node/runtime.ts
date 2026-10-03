import * as nodeFs from "node:fs/promises";
import nodePath from "node:path";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import type { FileStore, Http, Shell, Paths, Runtime } from "@/core/ports";
import { isNotFound } from "@/core/fsErrors";
import { executeBySpawn, PARENT_WATCHDOG } from "@/core/superviseProcess";

const APP_IDENTIFIER = "com.sean.allonomic";

const fs: FileStore = {
  readText: (path) => nodeFs.readFile(path, "utf8"),
  writeText: async (path, content, options) => {
    if (options?.append) {
      await nodeFs.appendFile(path, content, "utf8");
    } else {
      await nodeFs.writeFile(path, content, "utf8");
    }
  },
  mkdir: async (path) => {
    await nodeFs.mkdir(path, { recursive: true });
  },
  exists: async (path) => {
    try {
      await nodeFs.access(path);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  },
  readDir: async (path) => {
    const entries = await nodeFs.readdir(path, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile() }));
  },
  copyFile: (source, destination) => nodeFs.copyFile(source, destination),
};

function killGroup(pid: number | undefined, signal: NodeJS.Signals) {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

const spawnProcess: Shell["spawn"] = async (program, args, { cwd, onOutput }) => {
  const child = spawn(program, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => onOutput("stdout", String(chunk)));
  child.stderr.on("data", (chunk) => onOutput("stderr", String(chunk)));
  const exited = new Promise<number | null>((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", (error) => {
      onOutput("stderr", error.message);
      resolve(1);
    });
  });
  if (child.pid !== undefined)
    spawn("sh", ["-c", PARENT_WATCHDOG, String(child.pid)], { stdio: "ignore" });
  return { exited, kill: async (signal) => killGroup(child.pid, signal) };
};

const shell: Shell = {
  spawn: spawnProcess,
  execute: (program, args, options) => executeBySpawn(spawnProcess, program, args, options),
};

const http: Http = {
  post: async (url, json) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(json),
    });
    return { status: res.status, body: await res.text() };
  },
};

export function createNodeRuntime(projectRoot: string = process.cwd()): Runtime {
  const paths: Paths = {
    resolve: async (...parts) => nodePath.resolve(...parts),
    resource: async (relativePath) => nodePath.resolve(projectRoot, relativePath),
    home: async () => homedir(),
    appConfig: async () =>
      process.platform === "darwin"
        ? nodePath.join(homedir(), "Library", "Application Support", APP_IDENTIFIER)
        : nodePath.join(
            process.env.XDG_CONFIG_HOME ?? nodePath.join(homedir(), ".config"),
            APP_IDENTIFIER
          ),
  };
  return { platform: process.platform, fs, shell, http, paths };
}
