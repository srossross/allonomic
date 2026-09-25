import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function findApiKey(): string | undefined {
  if (process.env.API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
    return process.env.API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  }

  let dir = process.cwd();
  for (let index = 0; index < 4; index++) {
    const environmentPath = path.resolve(dir, ".env");
    if (existsSync(environmentPath)) {
      const content = readFileSync(environmentPath, "utf8");
      for (const line of content.split("\n")) {
        const match = line.match(/^\s*(API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY)\s*=\s*(.*)?\s*$/);
        if (!match) continue;
        const value = match[2]?.trim().replaceAll(/^['"]|['"]$/g, "");
        if (value) return value;
      }
    }
    const parent = path.resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
