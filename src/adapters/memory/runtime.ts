import type {
  DirEntry,
  FileStore,
  Http,
  HttpResponse,
  Paths,
  Runtime,
  KillSignal,
  Shell,
  ShellOptions,
  ShellProcess,
  ShellResult,
  ShellStream,
  SpawnOptions,
} from "@/core/ports";
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
    const entries: DirEntry[] = [];
    for (const dir of this.dirs) {
      if (dir === path || dirname(dir) !== path) continue;
      entries.push({ name: basename(dir), isDirectory: true, isFile: false });
    }
    for (const file of this.files.keys()) {
      if (dirname(file) === path) {
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
  readonly calls: Array<{ program: string; args: string[]; options?: ShellOptions }> = [];
  readonly spawned: Array<{ program: string; args: string[]; process: ScriptedProcess }> = [];
  constructor(
    private readonly handler: (
      program: string,
      args: string[],
      options?: ShellOptions
    ) => ShellResult | Promise<ShellResult> = () => ({
      code: 0,
      stdout: "",
      stderr: "",
    }),
    private readonly isReplayingSpawns = true
  ) {}

  private async replay(child: ScriptedProcess, program: string, args: string[], cwd?: string) {
    const { code, stdout, stderr } = await this.handler(program, args, { cwd });
    if (stdout) child.emit("stdout", stdout);
    if (stderr) child.emit("stderr", stderr);
    child.exit(code);
  }

  async execute(program: string, args: string[], options?: ShellOptions): Promise<ShellResult> {
    this.calls.push({ program, args, options });
    return this.handler(program, args, options);
  }

  async spawn(program: string, args: string[], options: SpawnOptions): Promise<ShellProcess> {
    const child = new ScriptedProcess(options);
    this.calls.push({ program, args, options: { cwd: options.cwd } });
    this.spawned.push({ program, args, process: child });
    if (this.isReplayingSpawns) void this.replay(child, program, args, options.cwd);
    return child;
  }
}

export class ScriptedProcess implements ShellProcess {
  private finish: (code: number | null) => void = () => {};
  readonly signals: KillSignal[] = [];
  readonly exited: Promise<number | null>;

  constructor(private readonly options: SpawnOptions) {
    this.exited = new Promise((resolve) => {
      this.finish = resolve;
    });
  }

  emit(stream: ShellStream, text: string) {
    this.options.onOutput(stream, text);
  }

  exit(code: number | null) {
    this.finish(code);
  }

  async kill(signal: KillSignal): Promise<void> {
    this.signals.push(signal);
    this.finish(null);
  }
}

export class ScriptedHttp implements Http {
  readonly calls: Array<{ url: string; json: unknown }> = [];
  constructor(
    private readonly handler: (url: string, json: unknown) => HttpResponse = () => ({
      status: 200,
      body: "",
    })
  ) {}

  async post(url: string, json: unknown): Promise<HttpResponse> {
    this.calls.push({ url, json });
    return this.handler(url, json);
  }
}

export function createMemoryRuntime(
  options: { resourceRoot?: string; platform?: string } = {}
): Runtime & { fs: MemoryFileStore; shell: ScriptedShell; http: ScriptedHttp } {
  const fs = new MemoryFileStore();
  const shell = new ScriptedShell();
  const http = new ScriptedHttp();
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
    home: async () => "/home/test",
    appConfig: async () => "/appconfig",
  };
  return { platform: options.platform ?? "darwin", fs, shell, http, paths };
}
