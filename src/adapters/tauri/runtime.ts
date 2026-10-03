import {
  readTextFile,
  writeTextFile,
  mkdir,
  exists,
  readDir,
  copyFile,
} from "@tauri-apps/plugin-fs";
import { appConfigDir, homeDir, resolve, resolveResource } from "@tauri-apps/api/path";
import { Command } from "@tauri-apps/plugin-shell";
import { fetch } from "@tauri-apps/plugin-http";
import type { FileStore, Http, Shell, Paths, Runtime } from "@/core/ports";
import { executeBySpawn, GROUP_WRAPPER, PGID_MARKER } from "@/core/superviseProcess";

const fs: FileStore = {
  readText: (path) => readTextFile(path),
  writeText: (path, content, options) =>
    writeTextFile(path, content, options?.append ? { append: true } : undefined),
  mkdir: (path) => mkdir(path, { recursive: true }),
  exists: (path) => exists(path),
  readDir: async (path) => {
    const entries = await readDir(path);
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory, isFile: e.isFile }));
  },
  copyFile: (source, destination) => copyFile(source, destination),
};

function asLine(line: string) {
  return line.endsWith("\n") ? line : `${line}\n`;
}

const spawnProcess: Shell["spawn"] = async (program, args, { cwd, onOutput }) => {
  const command = Command.create("sh", ["-c", GROUP_WRAPPER, "sh", program, ...args], { cwd });
  let pgid: string | undefined;
  command.stdout.on("data", (line: string) => onOutput("stdout", asLine(line)));
  command.stderr.on("data", (line: string) => {
    if (pgid === undefined && line.startsWith(PGID_MARKER)) {
      pgid = line.slice(PGID_MARKER.length).trim();
      return;
    }
    onOutput("stderr", asLine(line));
  });
  const exited = new Promise<number | null>((resolve) => {
    command.on("close", ({ code }) => resolve(code));
    command.on("error", (error) => {
      onOutput("stderr", error);
      resolve(1);
    });
  });
  await command.spawn();
  return {
    exited,
    kill: async (signal) => {
      if (pgid === undefined) return;
      await Command.create("sh", ["-c", 'kill -s "$0" -- "-$1"', signal.slice(3), pgid]).execute();
    },
  };
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

const paths: Paths = {
  resolve: (...parts) => resolve(...parts),
  resource: (relativePath) => resolveResource(relativePath),
  home: () => homeDir(),
  appConfig: () => appConfigDir(),
};

function detectPlatform(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Mac")) return "darwin";
  if (ua.includes("Windows")) return "win32";
  return ua.includes("Linux") ? "linux" : "unknown";
}

export const tauriRuntime: Runtime = { platform: detectPlatform(), fs, shell, http, paths };
