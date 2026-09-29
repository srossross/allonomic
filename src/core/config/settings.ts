import YAML from "yaml";
import { z } from "zod";
import {
  DEFAULT_EXECUTION_MODE,
  DEFAULT_GOVERNOR_MODE,
  DEFAULT_MODEL_ID,
  EXECUTION_MODE_LEVELS,
  GOVERNOR_MODES,
  type ExecutionMode,
  type GovernorMode,
  type ThinkingLevel,
} from "../../types/chat";
import { AVAILABLE_TOOLS } from "../../types/tools";
import type { Runtime } from "../ports";
import { join } from "../paths";
import {
  DEFAULT_SANDBOX_CONFIG,
  combineSandbox,
  parseSandboxConfig,
  replaceSandbox,
  sandboxSchema,
  sandboxToLayer,
  type SandboxConfig,
} from "../tools/sandboxConfig";

const USER_CONFIG_FILE = "config.yml";
const LEGACY_SANDBOX_FILE = "sandbox.yml";

const EXECUTION_MODE_IDS = [
  "restricted",
  "read",
  "write",
  "god",
] as const satisfies readonly ExecutionMode[];
const THINKING_LEVELS = ["Off", "Low", "Medium", "High"] as const;

const interceptorLayerSchema = z.object({
  model: z.string().optional(),
  thinking_level: z.enum(THINKING_LEVELS).optional(),
});

const layerSchema = z.object({
  execution_mode: z.enum(EXECUTION_MODE_IDS).optional(),
  network_access: z.boolean().optional(),
  governor_mode: z.enum(GOVERNOR_MODES).optional(),
  teacher: z.boolean().optional(),
  model: z.string().optional(),
  thinking_level: z.enum(THINKING_LEVELS).optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  interceptors: z.record(z.string(), interceptorLayerSchema).optional(),
  sandbox: sandboxSchema.optional(),
});

const projectSchema = layerSchema.extend({
  sessions: z.record(z.string(), layerSchema).optional(),
});

const userSchema = layerSchema.extend({
  projects: z.record(z.string(), projectSchema).optional(),
});

export type SettingsLayer = z.infer<typeof layerSchema>;
export type UserConfig = z.infer<typeof userSchema>;

export interface InterceptorSettings {
  model?: string;
  thinkingLevel?: ThinkingLevel;
}

export interface Settings {
  executionMode: ExecutionMode;
  networkAccess: boolean;
  governorMode: GovernorMode;
  teacherEnabled: boolean;
  model: string;
  thinkingLevel: ThinkingLevel;
  enabledTools: string[];
  interceptors: Record<string, InterceptorSettings>;
  sandbox: SandboxConfig;
}

export type SettingsPatch = Partial<Omit<Settings, "enabledTools" | "interceptors" | "sandbox">> & {
  tools?: Record<string, boolean>;
  interceptors?: Record<string, InterceptorSettings>;
};

export const DEFAULT_SETTINGS: Settings = {
  executionMode: DEFAULT_EXECUTION_MODE,
  networkAccess: false,
  governorMode: DEFAULT_GOVERNOR_MODE,
  teacherEnabled: true,
  model: DEFAULT_MODEL_ID,
  thinkingLevel: "Low",
  enabledTools: AVAILABLE_TOOLS.map((t) => t.name),
  interceptors: {},
  sandbox: DEFAULT_SANDBOX_CONFIG,
};

function applyTools(enabled: string[], tools: Record<string, boolean> | undefined): string[] {
  return tools
    ? AVAILABLE_TOOLS.map((t) => t.name).filter((name) => tools[name] ?? enabled.includes(name))
    : enabled;
}

function applyInterceptors(
  interceptors: Record<string, InterceptorSettings>,
  layer: SettingsLayer["interceptors"]
): Record<string, InterceptorSettings> {
  if (!layer) return interceptors;
  const merged = { ...interceptors };
  for (const [name, { model, thinking_level }] of Object.entries(layer)) {
    merged[name] = {
      model: model ?? merged[name]?.model,
      thinkingLevel: thinking_level ?? merged[name]?.thinkingLevel,
    };
  }
  return merged;
}

function applyLayer(
  settings: Settings,
  layer: SettingsLayer,
  mergeSandbox: typeof replaceSandbox
): Settings {
  return {
    executionMode: layer.execution_mode ?? settings.executionMode,
    networkAccess: layer.network_access ?? settings.networkAccess,
    governorMode: layer.governor_mode ?? settings.governorMode,
    teacherEnabled: layer.teacher ?? settings.teacherEnabled,
    model: layer.model ?? settings.model,
    thinkingLevel: layer.thinking_level ?? settings.thinkingLevel,
    enabledTools: applyTools(settings.enabledTools, layer.tools),
    interceptors: applyInterceptors(settings.interceptors, layer.interceptors),
    sandbox: layer.sandbox ? mergeSandbox(settings.sandbox, layer.sandbox) : settings.sandbox,
  };
}

function tightenLayer(settings: Settings, layer: SettingsLayer): Settings {
  const mode = layer.execution_mode;
  const governor = layer.governor_mode;
  const disabled = new Set(
    Object.entries(layer.tools ?? {})
      .filter(([, isEnabled]) => !isEnabled)
      .map(([name]) => name)
  );
  return {
    executionMode:
      mode && EXECUTION_MODE_LEVELS[mode] < EXECUTION_MODE_LEVELS[settings.executionMode]
        ? mode
        : settings.executionMode,
    networkAccess: layer.network_access !== false && settings.networkAccess,
    governorMode:
      governor && GOVERNOR_MODES.indexOf(governor) > GOVERNOR_MODES.indexOf(settings.governorMode)
        ? governor
        : settings.governorMode,
    teacherEnabled: layer.teacher === true || settings.teacherEnabled,
    model: settings.model,
    thinkingLevel: settings.thinkingLevel,
    enabledTools: settings.enabledTools.filter((name) => !disabled.has(name)),
    interceptors: settings.interceptors,
    sandbox: {
      ...settings.sandbox,
      deny: [...settings.sandbox.deny, ...(layer.sandbox?.deny ?? [])],
    },
  };
}

function defaultUserConfig(sandbox: SandboxConfig): UserConfig {
  return {
    execution_mode: DEFAULT_SETTINGS.executionMode,
    network_access: DEFAULT_SETTINGS.networkAccess,
    governor_mode: DEFAULT_SETTINGS.governorMode,
    teacher: DEFAULT_SETTINGS.teacherEnabled,
    model: DEFAULT_SETTINGS.model,
    thinking_level: DEFAULT_SETTINGS.thinkingLevel,
    sandbox: sandboxToLayer(sandbox),
  };
}

async function userConfigPath(runtime: Runtime): Promise<string> {
  return join(await runtime.paths.appConfig(), USER_CONFIG_FILE);
}

async function initialUserConfig(runtime: Runtime): Promise<UserConfig> {
  const legacyPath = join(await runtime.paths.appConfig(), LEGACY_SANDBOX_FILE);
  if (!(await runtime.fs.exists(legacyPath))) return defaultUserConfig(DEFAULT_SANDBOX_CONFIG);
  try {
    return defaultUserConfig(parseSandboxConfig(await runtime.fs.readText(legacyPath)));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid config ${legacyPath}: ${message}`, { cause: error });
  }
}

export async function saveUserConfig(runtime: Runtime, config: UserConfig): Promise<void> {
  await runtime.fs.mkdir(await runtime.paths.appConfig());
  await runtime.fs.writeText(await userConfigPath(runtime), YAML.stringify(config));
}

async function parseFile<T>(runtime: Runtime, path: string, schema: z.ZodType<T>): Promise<T> {
  try {
    return schema.parse(YAML.parse(await runtime.fs.readText(path)) ?? {});
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid config ${path}: ${message}`, { cause: error });
  }
}

export async function loadUserConfig(runtime: Runtime): Promise<UserConfig> {
  const path = await userConfigPath(runtime);
  if (await runtime.fs.exists(path)) return parseFile(runtime, path, userSchema);
  const config = await initialUserConfig(runtime);
  await saveUserConfig(runtime, config);
  return config;
}

async function loadRepoProjectLayer(runtime: Runtime, project: string): Promise<SettingsLayer> {
  const path = join(project, ".allonomic", USER_CONFIG_FILE);
  return (await runtime.fs.exists(path)) ? parseFile(runtime, path, layerSchema) : {};
}

async function loadRepoSessionLayer(
  runtime: Runtime,
  project: string,
  sessionId: string
): Promise<SettingsLayer> {
  const path = join(project, ".allonomic", "sessions", sessionId, "metadata.yml");
  if (!(await runtime.fs.exists(path))) return {};
  const data: unknown = YAML.parse(await runtime.fs.readText(path));
  if (!data || typeof data !== "object") return {};
  const layer: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(layerSchema.shape)) {
    const parsed = field.safeParse(Reflect.get(data, key));
    if (parsed.success && parsed.data !== undefined) layer[key] = parsed.data;
  }
  return layerSchema.parse(layer);
}

export async function resolveSettings(
  runtime: Runtime,
  workspaceDir: string,
  sessionId?: string
): Promise<Settings> {
  const project = await runtime.paths.resolve(workspaceDir);
  const user = await loadUserConfig(runtime);
  const userProject = user.projects?.[project] ?? {};
  const userSession = sessionId ? (userProject.sessions?.[sessionId] ?? {}) : {};

  const repoProject = await loadRepoProjectLayer(runtime, project);
  const repoSession = sessionId ? await loadRepoSessionLayer(runtime, project, sessionId) : {};

  let settings = applyLayer(DEFAULT_SETTINGS, user, replaceSandbox);
  settings = applyLayer(
    settings,
    { model: repoProject.model, thinking_level: repoProject.thinking_level },
    combineSandbox
  );
  settings = applyLayer(settings, userProject, combineSandbox);
  settings = applyLayer(settings, userSession, combineSandbox);
  settings = tightenLayer(settings, repoProject);
  return tightenLayer(settings, repoSession);
}

function patchToLayer(patch: SettingsPatch): SettingsLayer {
  return {
    ...(patch.executionMode && { execution_mode: patch.executionMode }),
    ...(patch.networkAccess !== undefined && { network_access: patch.networkAccess }),
    ...(patch.governorMode && { governor_mode: patch.governorMode }),
    ...(patch.teacherEnabled !== undefined && { teacher: patch.teacherEnabled }),
    ...(patch.model && { model: patch.model }),
    ...(patch.thinkingLevel && { thinking_level: patch.thinkingLevel }),
    ...(patch.tools && { tools: patch.tools }),
    ...(patch.interceptors && {
      interceptors: Object.fromEntries(
        Object.entries(patch.interceptors).map(([name, { model, thinkingLevel }]) => [
          name,
          { model, thinking_level: thinkingLevel },
        ])
      ),
    }),
  };
}

export async function updateSessionSettings(
  runtime: Runtime,
  workspaceDir: string,
  sessionId: string,
  patch: SettingsPatch
): Promise<Settings> {
  const project = await runtime.paths.resolve(workspaceDir);
  const user = await loadUserConfig(runtime);
  const userProject = user.projects?.[project] ?? {};
  const session = userProject.sessions?.[sessionId] ?? {};
  const layer = patchToLayer(patch);
  const nextSession: SettingsLayer = {
    ...session,
    ...layer,
    ...(layer.tools && { tools: { ...session.tools, ...layer.tools } }),
    ...(layer.interceptors && {
      interceptors: { ...session.interceptors, ...layer.interceptors },
    }),
  };
  await saveUserConfig(runtime, {
    ...user,
    projects: {
      ...user.projects,
      [project]: {
        ...userProject,
        sessions: { ...userProject.sessions, [sessionId]: nextSession },
      },
    },
  });
  return resolveSettings(runtime, workspaceDir, sessionId);
}
