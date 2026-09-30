import type { Runtime } from "../ports";
import { combineSandbox, replaceSandbox } from "../tools/sandboxConfig";
import {
  DEFAULT_SETTINGS,
  applyLayer,
  layerSchema,
  loadRepoProjectLayer,
  loadUserConfig,
  saveUserConfig,
  type Settings,
  type SettingsLayer,
} from "./settings";

export const SETTINGS_SCOPES = ["user", "project", "session"] as const;

export type SettingsScope = (typeof SETTINGS_SCOPES)[number];

export interface ScopedSettings {
  layers: Record<SettingsScope, SettingsLayer>;
  repoDefaults: Pick<SettingsLayer, "model" | "thinking_level">;
  inherited: Record<SettingsScope, Settings>;
}

export async function loadScopedSettings(
  runtime: Runtime,
  workspaceDir: string,
  sessionId: string | undefined
): Promise<ScopedSettings> {
  const project = await runtime.paths.resolve(workspaceDir);
  const { projects, ...user } = await loadUserConfig(runtime);
  const { sessions, ...userProject } = projects?.[project] ?? {};
  const userSession = sessionId ? (sessions?.[sessionId] ?? {}) : {};
  const repoProject = await loadRepoProjectLayer(runtime, project);
  const repoDefaults = { model: repoProject.model, thinking_level: repoProject.thinking_level };

  const projectBase = applyLayer(
    applyLayer(DEFAULT_SETTINGS, user, replaceSandbox),
    repoDefaults,
    combineSandbox
  );
  return {
    layers: { user, project: userProject, session: userSession },
    repoDefaults,
    inherited: {
      user: DEFAULT_SETTINGS,
      project: projectBase,
      session: applyLayer(projectBase, userProject, combineSandbox),
    },
  };
}

export async function saveSettingsLayer(
  runtime: Runtime,
  workspaceDir: string,
  sessionId: string | undefined,
  scope: SettingsScope,
  layer: SettingsLayer
): Promise<void> {
  const next = layerSchema.parse(layer);
  const user = await loadUserConfig(runtime);
  if (scope === "user") {
    await saveUserConfig(runtime, { ...next, projects: user.projects });
    return;
  }

  const project = await runtime.paths.resolve(workspaceDir);
  const userProject = user.projects?.[project] ?? {};
  if (scope === "project") {
    await saveUserConfig(runtime, {
      ...user,
      projects: { ...user.projects, [project]: { ...next, sessions: userProject.sessions } },
    });
    return;
  }

  if (!sessionId) throw new Error("A session-scoped settings change needs a session id");
  await saveUserConfig(runtime, {
    ...user,
    projects: {
      ...user.projects,
      [project]: { ...userProject, sessions: { ...userProject.sessions, [sessionId]: next } },
    },
  });
}
