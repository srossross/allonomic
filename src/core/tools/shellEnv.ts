import YAML from "yaml";
import { z } from "zod";
import type { Runtime } from "../ports";

const ENV_DEFAULTS_FILE = "app-data/env-defaults.yml";

const envDefaultsSchema = z.object({ env: z.record(z.string(), z.string()) });

export async function loadEnvDefaults(runtime: Runtime): Promise<Record<string, string>> {
  const path = await runtime.paths.resource(ENV_DEFAULTS_FILE);
  if (!(await runtime.fs.exists(path))) return {};
  const parsed = envDefaultsSchema.safeParse(YAML.parse(await runtime.fs.readText(path)) ?? {});
  if (!parsed.success) throw new Error(`Invalid ${path}: ${parsed.error.message}`);
  return parsed.data.env;
}

export async function shellEnv(
  runtime: Runtime,
  overrides: Record<string, string>
): Promise<Record<string, string>> {
  return { ...(await loadEnvDefaults(runtime)), ...overrides };
}
