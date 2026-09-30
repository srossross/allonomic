import { SANDBOX_LEVELS, type SandboxLevel } from "@/core/tools/sandboxConfig";
import { PathList } from "./PathList";
import { SectionHeader } from "./SettingRow";
import { withEntry, withKey, type SectionProperties } from "./layerEdit";

const ACCESSES = ["read", "write"] as const;

export function SandboxSection({ scoped, scope, update }: SectionProperties) {
  const layer = scoped.layers[scope];
  const inherited = scoped.inherited[scope].sandbox;
  const sandbox = layer.sandbox ?? {};
  const isReplacing = scope === "user";

  const setSandbox = (next: typeof sandbox | undefined) => update(withKey(layer, "sandbox", next));
  const setTier = (level: SandboxLevel, access: (typeof ACCESSES)[number], paths?: string[]) => {
    const tier = withEntry(sandbox[level] ?? {}, access, paths);
    setSandbox(withEntry(sandbox, level, tier));
  };

  return (
    <>
      <SectionHeader>Sandbox</SectionHeader>
      <div className="divide-border/30 divide-y">
        <PathList
          label="Deny"
          inherited={inherited.deny}
          own={sandbox.deny}
          isReplacing={isReplacing}
          onChange={(deny) => setSandbox(withEntry(sandbox, "deny", deny))}
        />
        {SANDBOX_LEVELS.flatMap((level) =>
          ACCESSES.map((access) => (
            <PathList
              key={`${level}-${access}`}
              label={`Level ${level} ${access}`}
              inherited={inherited.tiers[level][access]}
              own={sandbox[level]?.[access]}
              isReplacing={isReplacing}
              onChange={(paths) => setTier(level, access, paths)}
            />
          ))
        )}
      </div>
    </>
  );
}
