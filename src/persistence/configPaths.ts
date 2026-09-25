import os from "node:os";
import path from "node:path";
import process from "node:process";

/**
 * Returns the OS standard application configuration directory for 'allonomic',
 * matching Tauri's appConfigDir() convention.
 */
export function getAppConfigDir(): string {
  if (process.env.ALLONOMIC_CONFIG_DIR) {
    return process.env.ALLONOMIC_CONFIG_DIR;
  }
  if (process.env.ATOMIC_CONFIG_DIR) {
    return process.env.ATOMIC_CONFIG_DIR;
  }

  const homedir = os.homedir();
  switch (process.platform) {
    case "darwin": {
      return path.join(homedir, "Library", "Application Support", "com.sean.allonomic");
    }
    case "win32": {
      const appData = process.env.APPDATA || path.join(homedir, "AppData", "Roaming");
      return path.join(appData, "com.sean.allonomic");
    }
    default: {
      const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(homedir, ".config");
      return path.join(xdgConfig, "allonomic");
    }
  }
}
