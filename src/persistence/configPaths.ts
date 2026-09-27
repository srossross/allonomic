import { appConfigDir } from "@tauri-apps/api/path";

/**
 * Returns the OS standard application configuration directory.
 */
export async function getAppConfigDir(): Promise<string> {
  return await appConfigDir();
}
