import type { Runtime } from "./ports";
import type { ContextFile } from "./turn/events";
import { join } from "./paths";
import { isNotFound } from "./fsErrors";

const USER_CONFIG_DIR = ".allonomic";

export interface LoadedFile {
  path: string;
  text: string;
  missing: boolean;
  loadedAt: string;
  sha256?: string;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readContextFile(runtime: Runtime, path: string): Promise<LoadedFile> {
  const loadedAt = new Date().toISOString();
  let text: string;
  try {
    text = await runtime.fs.readText(path);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return { path, text: "", missing: true, loadedAt };
  }
  return { path, text, missing: false, loadedAt, sha256: await sha256Hex(text) };
}

export async function userConfigDir(runtime: Runtime): Promise<string> {
  return join(await runtime.paths.home(), USER_CONFIG_DIR);
}

export async function loadRuleFiles(
  runtime: Runtime,
  workspaceDir: string,
  relativePath: string
): Promise<LoadedFile[]> {
  const [userDir, workspace] = await Promise.all([
    userConfigDir(runtime),
    runtime.paths.resolve(workspaceDir),
  ]);
  return Promise.all(
    [join(userDir, relativePath), join(workspace, relativePath)].map((path) =>
      readContextFile(runtime, path)
    )
  );
}

export function ruleSections(files: LoadedFile[]): string[] {
  return files
    .filter((file) => file.text.trim())
    .map((file) => `## Rules (${file.path})\n${file.text.trim()}`);
}

export function toContextFiles(files: LoadedFile[]): ContextFile[] {
  return files.map(({ path, text, missing, loadedAt, sha256 }) => ({
    path,
    size: text.length,
    missing,
    loadedAt,
    sha256,
  }));
}

export type PathOrigin = "ws" | "app" | "user" | "/";

export interface PathRoots {
  ws?: string;
  app?: string;
  user?: string;
}

export function classifyPath(
  path: string,
  roots: PathRoots
): { origin: PathOrigin; relative: string } {
  const matches = (["ws", "app", "user"] as const)
    .map((origin) => ({ origin, root: roots[origin]?.replace(/\/+$/, "") }))
    .filter(({ root }) => root && path.startsWith(`${root}/`))
    .toSorted((a, b) => (b.root?.length ?? 0) - (a.root?.length ?? 0));
  const [best] = matches;
  return best?.root
    ? { origin: best.origin, relative: path.slice(best.root.length + 1) }
    : { origin: "/", relative: path };
}
