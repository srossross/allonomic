export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

export interface FileStore {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string, options?: { append?: boolean }): Promise<void>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  readDir(path: string): Promise<DirEntry[]>;
  copyFile(source: string, destination: string): Promise<void>;
}

export type ShellTermination = "stopped" | "timeout";

export interface ShellResult {
  code: number | null;
  stdout: string;
  stderr: string;
  termination?: ShellTermination;
}

export interface ShellOptions {
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type ShellStream = "stdout" | "stderr";
export type KillSignal = "SIGTERM" | "SIGKILL";

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  onOutput(stream: ShellStream, text: string): void;
}

export interface ShellProcess {
  exited: Promise<number | null>;
  kill(signal: KillSignal): Promise<void>;
}

export interface Shell {
  execute(program: string, args: string[], options?: ShellOptions): Promise<ShellResult>;
  spawn(program: string, args: string[], options: SpawnOptions): Promise<ShellProcess>;
}

export interface HttpResponse {
  status: number;
  body: string;
}

export interface Http {
  post(url: string, json: unknown): Promise<HttpResponse>;
}

export interface Paths {
  resolve(...parts: string[]): Promise<string>;
  resource(relativePath: string): Promise<string>;
  home(): Promise<string>;
  appConfig(): Promise<string>;
}

export interface Runtime {
  platform: string;
  fs: FileStore;
  shell: Shell;
  http: Http;
  paths: Paths;
}
