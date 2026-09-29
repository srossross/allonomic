import type { Runtime } from "../ports";
import {
  DEFAULT_SANDBOX_CONFIG,
  replaceSandbox,
  sandboxToLayer,
  type SandboxLayer,
  type SandboxLevel,
} from "../tools/sandboxConfig";
import { loadUserConfig, saveUserConfig, type SettingsLayer } from "./settings";

export type PermissionScope = "session" | "project" | "global";

type PathChange =
  | { op: "allow_read"; path: string; level: SandboxLevel }
  | { op: "allow_write"; path: string; level: SandboxLevel }
  | { op: "deny"; path: string };

export type PermissionChange = PathChange | { op: "network_on" } | { op: "network_off" };

function appendToSandbox(sandbox: SandboxLayer, change: PathChange): SandboxLayer {
  if (change.op === "deny") return { ...sandbox, deny: [...(sandbox.deny ?? []), change.path] };
  const access = change.op === "allow_read" ? "read" : "write";
  const tier = sandbox[change.level] ?? {};
  return {
    ...sandbox,
    [change.level]: { ...tier, [access]: [...(tier[access] ?? []), change.path] },
  };
}

function applyChange<T extends SettingsLayer>(
  layer: T,
  change: PermissionChange,
  sandboxBase: SandboxLayer
): T {
  return change.op === "network_on" || change.op === "network_off"
    ? { ...layer, network_access: change.op === "network_on" }
    : { ...layer, sandbox: appendToSandbox(sandboxBase, change) };
}

export async function applyPermissionChange(
  runtime: Runtime,
  workspaceDir: string,
  sessionId: string | undefined,
  scope: PermissionScope,
  change: PermissionChange
): Promise<void> {
  const user = await loadUserConfig(runtime);
  if (scope === "global") {
    const current = sandboxToLayer(replaceSandbox(DEFAULT_SANDBOX_CONFIG, user.sandbox ?? {}));
    await saveUserConfig(runtime, applyChange(user, change, current));
    return;
  }

  const project = await runtime.paths.resolve(workspaceDir);
  const userProject = user.projects?.[project] ?? {};
  if (scope === "project") {
    await saveUserConfig(runtime, {
      ...user,
      projects: {
        ...user.projects,
        [project]: applyChange(userProject, change, userProject.sandbox ?? {}),
      },
    });
    return;
  }

  if (!sessionId) throw new Error("A session-scoped permission change needs a session id");
  const session = userProject.sessions?.[sessionId] ?? {};
  await saveUserConfig(runtime, {
    ...user,
    projects: {
      ...user.projects,
      [project]: {
        ...userProject,
        sessions: {
          ...userProject.sessions,
          [sessionId]: applyChange(session, change, session.sandbox ?? {}),
        },
      },
    },
  });
}
