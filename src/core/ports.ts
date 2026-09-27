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

export interface ShellResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface Shell {
  execute(program: string, args: string[]): Promise<ShellResult>;
}

export interface Paths {
  resolve(...parts: string[]): Promise<string>;
  resource(relativePath: string): Promise<string>;
}

export interface Runtime {
  platform: string;
  fs: FileStore;
  shell: Shell;
  paths: Paths;
}
