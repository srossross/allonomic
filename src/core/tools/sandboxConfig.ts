import YAML from "yaml";
import { z } from "zod";
import type { AccessLevel } from "@/types";
import type { Runtime } from "../ports";
import { join, normalize } from "../paths";

export type SandboxLevel = 1 | 2 | 3;

export const SANDBOX_LEVELS: SandboxLevel[] = [1, 2, 3];

const tierSchema = z.object({
  read: z.array(z.string()).optional(),
  write: z.array(z.string()).optional(),
});

export const sandboxSchema = z.object({
  deny: z.array(z.string()).optional(),
  1: tierSchema.optional(),
  2: tierSchema.optional(),
  3: tierSchema.optional(),
});

export type SandboxLayer = z.infer<typeof sandboxSchema>;

const configSchema = z.object({ sandbox: sandboxSchema.optional() });

interface SandboxTier {
  read: string[];
  write: string[];
}

export interface SandboxConfig {
  deny: string[];
  tiers: Record<SandboxLevel, SandboxTier>;
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  deny: ["$PROJECT/.allonomic"],
  tiers: {
    1: {
      read: ["$PROJECT", "$TMP", "/bin", "/usr", "/System", "/Library", "/dev"],
      write: ["$TMP"],
    },
    2: {
      read: ["/"],
      write: [
        "~/.cache",
        "~/.npm",
        "~/.bun/install/cache",
        "~/.cargo/registry",
        "~/go/pkg",
        "~/Library/Caches",
      ],
    },
    3: { read: [], write: ["$PROJECT"] },
  },
};

export function sandboxToLayer(config: SandboxConfig): SandboxLayer {
  return { deny: config.deny, ...config.tiers };
}

export function replaceSandbox(base: SandboxConfig, layer: SandboxLayer): SandboxConfig {
  const tier = (level: SandboxLevel): SandboxTier => ({
    read: layer[level]?.read ?? base.tiers[level].read,
    write: layer[level]?.write ?? base.tiers[level].write,
  });
  return {
    deny: layer.deny ?? base.deny,
    tiers: { 1: tier(1), 2: tier(2), 3: tier(3) },
  };
}

export function combineSandbox(base: SandboxConfig, layer: SandboxLayer): SandboxConfig {
  const tier = (level: SandboxLevel): SandboxTier => ({
    read: [...base.tiers[level].read, ...(layer[level]?.read ?? [])],
    write: [...base.tiers[level].write, ...(layer[level]?.write ?? [])],
  });
  return {
    deny: [...base.deny, ...(layer.deny ?? [])],
    tiers: { 1: tier(1), 2: tier(2), 3: tier(3) },
  };
}

export function parseSandboxConfig(raw: string): SandboxConfig {
  const sandbox = configSchema.parse(YAML.parse(raw) ?? {}).sandbox ?? {};
  return replaceSandbox(DEFAULT_SANDBOX_CONFIG, sandbox);
}

export interface SandboxVariables {
  project: string;
  tmp: string;
  home: string;
}

export function expand(path: string, { project, tmp, home }: SandboxVariables): string {
  const expanded = path
    .replaceAll("$PROJECT", () => project)
    .replaceAll("$TMP", () => tmp)
    .replace(/^~(?=\/|$)/, () => home);
  return expanded.length > 1 ? expanded.replace(/\/+$/, "") : expanded;
}

export interface SandboxRules {
  read: string[];
  write: string[];
  deny: string[];
}

export function sandboxRules(
  config: SandboxConfig,
  level: SandboxLevel,
  variables: SandboxVariables
): SandboxRules {
  const tiers = SANDBOX_LEVELS.filter((l) => l <= level).map((l) => config.tiers[l]);
  const resolve = (paths: string[]) => [...new Set(paths.map((p) => expand(p, variables)))];
  return {
    read: resolve(tiers.flatMap((t) => t.read)),
    write: resolve(tiers.flatMap((t) => t.write)),
    deny: resolve(config.deny),
  };
}

function isWithin(path: string, roots: string[]): boolean {
  return roots.some((root) => root === "/" || path === root || path.startsWith(`${root}/`));
}

export function pathLevel(
  config: SandboxConfig,
  access: "read" | "write",
  path: string,
  variables: SandboxVariables
): AccessLevel {
  const target = normalize(path);
  for (const level of SANDBOX_LEVELS) {
    const rules = sandboxRules(config, level, variables);
    if (isWithin(target, rules.deny)) return 4;
    if (isWithin(target, rules[access])) return level;
  }
  return 4;
}

export const SANDBOX_TMP_ROOT = "/private/tmp/at-sandbox";

function fnv1a(text: string): string {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.codePointAt(index)!;
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function sandboxVariables(
  runtime: Runtime,
  workspaceDir: string
): Promise<SandboxVariables> {
  const project = await runtime.paths.resolve(workspaceDir);
  return {
    project,
    tmp: join(SANDBOX_TMP_ROOT, fnv1a(project)),
    home: await runtime.paths.home(),
  };
}
