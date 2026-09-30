import type { SettingsLayer } from "@/core/config/settings";
import type { ScopedSettings, SettingsScope } from "@/core/config/scopedSettings";

export function withKey<T extends object, K extends keyof T>(
  object: T,
  key: K,
  value: T[K] | undefined
): T {
  const next = { ...object };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

export function withEntry<R extends object, K extends keyof R>(
  record: R,
  key: K,
  value: R[K] | undefined
): R | undefined {
  const next = withKey(record, key, value);
  return Object.keys(next).length > 0 ? next : undefined;
}

export function sourceOf(
  scoped: ScopedSettings,
  scope: SettingsScope,
  pick: (layer: SettingsLayer) => unknown
): string {
  const lower: Array<[string, SettingsLayer]> = [
    ["project", scoped.layers.project],
    ["repo", scoped.repoDefaults],
    ["user", scoped.layers.user],
  ];
  const candidates = scope === "session" ? lower : scope === "project" ? lower.slice(1) : [];
  return candidates.find(([, layer]) => pick(layer) !== undefined)?.[0] ?? "default";
}

export interface SectionProperties {
  scoped: ScopedSettings;
  scope: SettingsScope;
  update: (next: SettingsLayer) => void;
}
