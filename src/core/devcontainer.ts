import { LRUCache } from "lru-cache";
import type { Runtime } from "./ports";
import { join, dirname } from "./paths";

export type DevContainerStatus = "running" | "stopped" | "not_setup";

export interface DevContainer {
  containerId: string | null;
  status: DevContainerStatus;
  workdir: string | null;
}

interface RootEntry {
  containerId: string | null;
  status: DevContainerStatus;
  mountDestination: string | null;
}

const TTL_MS = 5000;
const FALLBACK_IMAGE = "debian:stable-slim";
const FALLBACK_LABEL = "at.local_folder";
const cache = new LRUCache<string, RootEntry>({ max: 64, ttl: TTL_MS });

export function clearDevContainerCache(): void {
  cache.clear();
}

export async function findDevContainerRoot(runtime: Runtime, startDir: string): Promise<string> {
  let currentDir = await runtime.paths.resolve(startDir);
  while (true) {
    if (await runtime.fs.exists(join(currentDir, ".devcontainer"))) return currentDir;
    if (await runtime.fs.exists(join(currentDir, ".devcontainer.json"))) return currentDir;
    const parent = dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }
  return await runtime.paths.resolve(startDir);
}

async function isConfigured(runtime: Runtime, rootDir: string): Promise<boolean> {
  return (
    (await runtime.fs.exists(join(rootDir, ".devcontainer.json"))) ||
    (await runtime.fs.exists(join(rootDir, ".devcontainer", "devcontainer.json")))
  );
}

async function inspectRoot(runtime: Runtime, rootDir: string): Promise<RootEntry> {
  const configured = await isConfigured(runtime, rootDir);
  const label = configured ? "devcontainer.local_folder" : FALLBACK_LABEL;
  const ps = await runtime.shell.execute("docker", [
    "ps",
    "-a",
    "--filter",
    `label=${label}=${rootDir}`,
    "--format",
    "{{.ID}}\t{{.State}}",
  ]);
  const rows = ps.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"));
  const running = rows.find(([, state]) => state === "running");
  if (!running) {
    const stopped = rows[0];
    if (stopped) return { containerId: stopped[0], status: "stopped", mountDestination: null };
    return {
      containerId: null,
      status: configured ? "stopped" : "not_setup",
      mountDestination: null,
    };
  }

  const containerId = running[0];
  const inspect = await runtime.shell.execute("docker", [
    "inspect",
    "-f",
    "{{range .Mounts}}{{.Source}}\t{{.Destination}}\n{{end}}",
    containerId,
  ]);
  const mount = inspect.stdout
    .split("\n")
    .map((line) => line.split("\t"))
    .find(([source]) => source === rootDir);
  return { containerId, status: "running", mountDestination: mount?.[1] ?? null };
}

export async function resolveDevContainer(
  runtime: Runtime,
  workspaceDir: string
): Promise<DevContainer> {
  const rootDir = await findDevContainerRoot(runtime, workspaceDir);
  let entry = cache.get(rootDir);
  if (!entry) {
    entry = await inspectRoot(runtime, rootDir);
    cache.set(rootDir, entry);
  }
  const hostDir = await runtime.paths.resolve(workspaceDir);
  const workdir = entry.mountDestination
    ? entry.mountDestination + hostDir.slice(rootDir.length)
    : null;
  return { containerId: entry.containerId, status: entry.status, workdir };
}

export async function invalidateDevContainer(
  runtime: Runtime,
  workspaceDir: string
): Promise<void> {
  cache.delete(await findDevContainerRoot(runtime, workspaceDir));
}

async function dockerOrThrow(runtime: Runtime, args: string[]): Promise<string> {
  const result = await runtime.shell.execute("docker", args);
  if (result.code !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

async function startContainer(runtime: Runtime, rootDir: string, dc: DevContainer): Promise<void> {
  if (dc.status === "running") return;
  if (dc.containerId) {
    await dockerOrThrow(runtime, ["start", dc.containerId]);
    return;
  }
  if (dc.status === "stopped")
    throw new Error("Dev container is configured but not created. Run `devcontainer up`.");
  const containerId = await dockerOrThrow(runtime, [
    "run",
    "-d",
    "--label",
    `${FALLBACK_LABEL}=${rootDir}`,
    "-v",
    `${rootDir}:${rootDir}`,
    "-w",
    rootDir,
    "--cap-add",
    "SYS_ADMIN",
    "--security-opt",
    "seccomp=unconfined",
    "--security-opt",
    "apparmor=unconfined",
    FALLBACK_IMAGE,
    "sleep",
    "infinity",
  ]);
  await dockerOrThrow(runtime, [
    "exec",
    containerId,
    "sh",
    "-c",
    "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y bubblewrap",
  ]);
}

const starting = new Map<string, Promise<void>>();

export async function ensureContainer(runtime: Runtime, workspaceDir: string): Promise<void> {
  const rootDir = await findDevContainerRoot(runtime, workspaceDir);
  const inFlight = starting.get(rootDir);
  if (inFlight) return inFlight;
  const task = (async () => {
    cache.delete(rootDir);
    try {
      await startContainer(runtime, rootDir, await resolveDevContainer(runtime, workspaceDir));
    } finally {
      starting.delete(rootDir);
      cache.delete(rootDir);
    }
  })();
  starting.set(rootDir, task);
  return task;
}
