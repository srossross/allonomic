import * as nodeFs from "node:fs/promises";
import nodePath from "node:path";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import type { FileStore, Shell, Paths, Runtime } from "@/core/ports";

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
    } catch {
      return false;
    }
  },
  readDir: async (path) => {
    const entries = await nodeFs.readdir(path, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile() }));
  },
  copyFile: (source, destination) => nodeFs.copyFile(source, destination),
};

const shell: Shell = {
  execute: (program, args) =>
    new Promise((resolve) => {
      execFile(program, args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        const code =
          error && "code" in error && typeof error.code === "number" ? error.code : error ? 1 : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      });
    }),
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
  return { platform: process.platform, fs, shell, paths };
}
