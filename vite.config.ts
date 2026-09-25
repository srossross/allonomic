import { defineConfig, type Plugin, type ViteDevServer, type Connect } from "vite";
import type { ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import process from "node:process";
import fs from "node:fs";
const host = process.env.TAURI_DEV_HOST;

let environmentApiKey = process.env.API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
if (!environmentApiKey) {
  try {
    const environmentFile = fs.readFileSync(path.resolve(import.meta.dirname, ".env"), "utf8");
    const match = environmentFile.match(/^\s*(?:API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY)\s*=\s*['"]?([^'"\n\r]+)/m);
    if (match) environmentApiKey = match[1];
  } catch {
    // .env file is optional or could not be read
  }
}

function sendJson(res: ServerResponse, data: unknown, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  sendJson(res, { error: message }, 500);
}

function readBody(request: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk: Buffer | string) => {
      body += String(chunk);
    });
    request.on("end", () => resolve(body));
  });
}

function agentApiPlugin(): Plugin {
  return {
    name: "agent-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(
        async (
          request: Connect.IncomingMessage,
          res: ServerResponse,
          next: Connect.NextFunction
        ) => {
          const parsedUrl = new URL(request.url || "", "http://localhost");
          const pathname = parsedUrl.pathname;

          if (pathname === "/api/agent/run" && request.method === "POST") {
            try {
              const body = await readBody(request);
              const {
                prompt,
                threadId,
                sessionId,
                workspaceDir,
                enabledTools,
                modelName,
                thinkingBudget,
                executionMode,
                history,
              } = JSON.parse(body || "{}");
              const agentServer = await server.ssrLoadModule("./src/agent/server.ts");
              const data = await agentServer.runAgentPrompt({
                prompt,
                threadId,
                sessionId: sessionId || threadId,
                workspaceDir,
                enabledTools,
                modelName,
                thinkingBudget,
                executionMode,
                history,
              });
              sendJson(res, data);
            } catch (error) {
              sendError(res, error);
            }
            return;
          }

          if (pathname === "/api/agent/stop" && request.method === "POST") {
            try {
              const body = await readBody(request);
              const { threadId, sessionId } = JSON.parse(body || "{}");
              const agentServer = await server.ssrLoadModule("./src/agent/server.ts");
              const stopped = agentServer.stopAgentPrompt(threadId, sessionId);
              sendJson(res, { stopped });
            } catch (error) {
              sendError(res, error);
            }
            return;
          }

          if (
            (pathname === "/api/models" || pathname === "/api/agent/models") &&
            request.method === "GET"
          ) {
            try {
              const { fetchAvailableModels } = await server.ssrLoadModule("./src/agent/models.ts");
              const models = await fetchAvailableModels(environmentApiKey);
              sendJson(res, { models });
            } catch (error) {
              sendError(res, error);
            }
            return;
          }

          if (pathname === "/api/agent/injectors" && request.method === "GET") {
            try {
              const agentServer = await server.ssrLoadModule("./src/agent/server.ts");
              const injectors = agentServer.getInstalledInjectors();
              sendJson(res, { injectors });
            } catch (error) {
              sendError(res, error);
            }
            return;
          }

          if (pathname === "/api/agent/state" && request.method === "GET") {
            try {
              const agentServer = await server.ssrLoadModule("./src/agent/server.ts");
              const state = agentServer.getGovernorState();
              sendJson(res, { governorState: state });
            } catch (error) {
              sendError(res, error);
            }
            return;
          }

          if (pathname === "/api/agent/reframe" && request.method === "POST") {
            try {
              const body = await readBody(request);
              const { description, options } = JSON.parse(body || "{}");
              const { reframeSatisfaction } = await server.ssrLoadModule(
                "./src/lib/reframeSatisfaction.ts"
              );
              const condition = await reframeSatisfaction(description, options);
              sendJson(res, { condition });
            } catch (error) {
              sendError(res, error);
            }
            return;
          }

          if (pathname === "/api/agent/apply-write" && request.method === "POST") {
            try {
              const body = await readBody(request);
              const { workspaceDir, filePath, content } = JSON.parse(body || "{}");
              const targetPath = path.resolve(workspaceDir || process.cwd(), filePath);
              await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
              await fs.promises.writeFile(targetPath, content, "utf8");
              sendJson(res, { success: true, filePath, bytesWritten: content.length });
            } catch (error) {
              sendError(res, error);
            }
            return;
          }

          if (pathname === "/api/agent/resume" && request.method === "POST") {
            try {
              const body = await readBody(request);
              const { threadId, sessionId, workspaceDir, toolId, resultString } = JSON.parse(body || "{}");
              const agentServer = await server.ssrLoadModule("./src/agent/server.ts");
              const result = await agentServer.resumeAgentPrompt(threadId, sessionId, workspaceDir, toolId, resultString);
              sendJson(res, result);
            } catch (error) {
              sendError(res, error);
            }
            return;
          }

          // Persistence APIs
          if (pathname === "/api/workspaces" && request.method === "GET") {
            try {
              const persistence = await server.ssrLoadModule("./src/persistence/index.ts");
              const config = await persistence.loadWorkspacesConfig();
              sendJson(res, config);
            } catch (error) {
              sendError(res, error);
            }
            return;
          }

          if (pathname === "/api/workspaces" && request.method === "POST") {
            try {
              const body = await readBody(request);
              const workspace = JSON.parse(body || "{}");
              const persistence = await server.ssrLoadModule("./src/persistence/index.ts");
              const config = await persistence.addOrUpdateWorkspace(workspace);
              sendJson(res, config);
            } catch (error) {
              sendError(res, error);
            }
            return;
          }

          if (pathname === "/api/workspaces/active" && request.method === "POST") {
            try {
              const body = await readBody(request);
              const { workspaceId } = JSON.parse(body || "{}");
              const persistence = await server.ssrLoadModule("./src/persistence/index.ts");
              const config = await persistence.setActiveWorkspaceId(workspaceId);
              sendJson(res, config);
            } catch (error) {
              sendError(res, error);
            }
            return;
          }

          if (pathname === "/api/workspace/state" && request.method === "GET") {
            try {
              const workspaceDir = parsedUrl.searchParams.get("workspaceDir") || process.cwd();
              const persistence = await server.ssrLoadModule("./src/persistence/index.ts");
              const state = await persistence.loadWorkspaceState(workspaceDir);
              sendJson(res, { state });
            } catch (error) {
              sendError(res, error);
            }
            return;
          }

          if (pathname === "/api/workspace/state" && request.method === "POST") {
            try {
              const body = await readBody(request);
              const { workspaceDir, state } = JSON.parse(body || "{}");
              const persistence = await server.ssrLoadModule("./src/persistence/index.ts");
              await persistence.saveWorkspaceState(workspaceDir || process.cwd(), state);
              sendJson(res, { success: true });
            } catch (error) {
              sendError(res, error);
            }
            return;
          }

          if (pathname === "/api/sessions" && request.method === "GET") {
            try {
              const workspaceDir = parsedUrl.searchParams.get("workspaceDir") || process.cwd();
              const persistence = await server.ssrLoadModule("./src/persistence/index.ts");
              const sessions = await persistence.listSessions(workspaceDir);
              sendJson(res, { sessions });
            } catch (error) {
              sendError(res, error);
            }
            return;
          }

          if (pathname === "/api/sessions/rehydrate" && request.method === "GET") {
            try {
              const workspaceDir = parsedUrl.searchParams.get("workspaceDir") || process.cwd();
              const sessionId = parsedUrl.searchParams.get("sessionId");
              if (!sessionId) {
                sendJson(res, { error: "Missing sessionId parameter" }, 400);
                return;
              }
              const persistence = await server.ssrLoadModule("./src/persistence/index.ts");
              const rehydrated = await persistence.rehydrateSession(workspaceDir, sessionId);
              sendJson(res, rehydrated);
            } catch (error) {
              sendError(res, error);
            }
            return;
          }

          if (pathname === "/api/sessions/metadata" && request.method === "POST") {
            try {
              const body = await readBody(request);
              const { workspaceDir, metadata } = JSON.parse(body || "{}");
              const persistence = await server.ssrLoadModule("./src/persistence/index.ts");
              await persistence.saveSessionMetadata(workspaceDir || process.cwd(), metadata);
              sendJson(res, { success: true });
            } catch (error) {
              sendError(res, error);
            }
            return;
          }

          next();
        }
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  define: {
    "process.env.API_KEY": JSON.stringify(environmentApiKey),
  },
  plugins: [react(), tailwindcss(), agentApiPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
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
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
