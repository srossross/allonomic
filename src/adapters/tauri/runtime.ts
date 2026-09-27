import {
  readTextFile,
  writeTextFile,
  mkdir,
  exists,
  readDir,
  copyFile,
} from "@tauri-apps/plugin-fs";
import { resolve, resolveResource } from "@tauri-apps/api/path";
import { Command } from "@tauri-apps/plugin-shell";
import type { FileStore, Shell, Paths, Runtime } from "@/core/ports";

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

const shell: Shell = {
  execute: async (program, args) => {
    const { code, stdout, stderr } = await Command.create(program, args).execute();
    return { code, stdout, stderr };
  },
};

const paths: Paths = {
  resolve: (...parts) => resolve(...parts),
  resource: (relativePath) => resolveResource(relativePath),
};

function detectPlatform(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Mac")) return "darwin";
  if (ua.includes("Windows")) return "win32";
  return ua.includes("Linux") ? "linux" : "unknown";
}

export const tauriRuntime: Runtime = { platform: detectPlatform(), fs, shell, paths };
