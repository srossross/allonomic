import type { DirEntry, FileStore, Paths, Runtime, Shell, ShellResult } from "@/core/ports";
import { dirname, basename, join } from "@/core/paths";

function notFound(path: string): Error {
  return new Error(`No such file or directory (os error 2): ${path}`);
}

export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>(["/"]);

  async readText(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw notFound(path);
    return content;
  }

  async writeText(path: string, content: string, options?: { append?: boolean }): Promise<void> {
    await this.mkdir(dirname(path));
    const previous = options?.append ? (this.files.get(path) ?? "") : "";
    this.files.set(path, previous + content);
  }

  async mkdir(path: string): Promise<void> {
    let current = path;
    while (!this.dirs.has(current)) {
      this.dirs.add(current);
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async readDir(path: string): Promise<DirEntry[]> {
    if (!this.dirs.has(path)) throw notFound(path);
    const names = new Set<string>();
    const entries: DirEntry[] = [];
    const prefix = path.endsWith("/") ? path : `${path}/`;
    for (const dir of this.dirs) {
      if (dir === path || dirname(dir) !== path) continue;
      const name = basename(dir);
      if (names.has(name)) continue;
      names.add(name);
      entries.push({ name, isDirectory: true, isFile: false });
    }
    for (const file of this.files.keys()) {
      if (file.startsWith(prefix) && dirname(file) === path) {
        entries.push({ name: basename(file), isDirectory: false, isFile: true });
      }
    }
    return entries;
  }

  async copyFile(source: string, destination: string): Promise<void> {
    await this.writeText(destination, await this.readText(source));
  }
}

export class ScriptedShell implements Shell {
  readonly calls: Array<{ program: string; args: string[] }> = [];
  constructor(
    private readonly handler: (program: string, args: string[]) => ShellResult = () => ({
      code: 0,
      stdout: "",
      stderr: "",
    })
  ) {}

  async execute(program: string, args: string[]): Promise<ShellResult> {
    this.calls.push({ program, args });
    return this.handler(program, args);
  }
}

export function createMemoryRuntime(
  options: { resourceRoot?: string; platform?: string } = {}
): Runtime & { fs: MemoryFileStore; shell: ScriptedShell } {
  const fs = new MemoryFileStore();
  const shell = new ScriptedShell();
  const resourceRoot = options.resourceRoot ?? "/resources";
  const paths: Paths = {
    resolve: async (...parts) => {
      let result = "";
      for (const part of parts) {
        result = part.startsWith("/") ? part : join(result, part);
      }
      return result.startsWith("/") ? result : join("/", result);
    },
    resource: async (relativePath) => join(resourceRoot, relativePath),
  };
  return { platform: options.platform ?? "darwin", fs, shell, paths };
}
