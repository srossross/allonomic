import type { Runtime } from "./ports";
import type { ContextFile } from "./turn/events";
import { join } from "./paths";

export const USER_CONFIG_DIR = ".allonomic";

export interface LoadedFile {
  path: string;
  text: string;
  missing: boolean;
  loadedAt: string;
}

export async function readContextFile(runtime: Runtime, path: string): Promise<LoadedFile> {
  const loadedAt = new Date().toISOString();
  try {
    return { path, text: await runtime.fs.readText(path), missing: false, loadedAt };
  } catch (error) {
    console.warn(`Failed to read ${path}:`, error);
    return { path, text: "", missing: true, loadedAt };
  }
}

export async function readOptionalContextFile(runtime: Runtime, path: string): Promise<LoadedFile> {
  return (await runtime.fs.exists(path))
    ? readContextFile(runtime, path)
    : { path, text: "", missing: true, loadedAt: new Date().toISOString() };
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
      readOptionalContextFile(runtime, path)
    )
  );
}

export function ruleSections(files: LoadedFile[]): string[] {
  return files
    .filter((file) => file.text.trim())
    .map((file) => `## Rules (${file.path})\n${file.text.trim()}`);
}

export function toContextFiles(files: LoadedFile[]): ContextFile[] {
  return files.map(({ path, text, missing, loadedAt }) => ({
    path,
    size: text.length,
    missing,
    loadedAt,
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
