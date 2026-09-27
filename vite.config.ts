import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

let environmentApiKey =
  process.env.API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
if (!environmentApiKey) {
  try {
    const environmentFile = fs.readFileSync(path.resolve(import.meta.dirname, ".env"), "utf8");
    const match = environmentFile.match(
      /^\s*(?:API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY)\s*=\s*['"]?([^'"\n\r]+)/m
    );
    if (match) environmentApiKey = match[1];
  } catch {
    // .env file is optional or could not be read
  }
}

export default defineConfig(() => ({
  define: {
    "process.env.API_KEY": JSON.stringify(environmentApiKey),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**", "**/.allonomic/**"],
    },
  },
}));
