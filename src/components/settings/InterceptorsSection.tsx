import type { InterceptorSettings } from "@/core/config/settings";
import { THINKING_LEVELS, type ModelOption } from "@/types";
import { SELECT_CLASS, SectionHeader } from "./SettingRow";
import { withEntry, withKey, type SectionProperties } from "./layerEdit";

interface InterceptorsSectionProperties extends SectionProperties {
  names: string[];
  models: ModelOption[];
}

type Field = "model" | "thinking_level";

export function InterceptorsSection({
  scoped,
  scope,
  update,
  names,
  models,
}: InterceptorsSectionProperties) {
  const layer = scoped.layers[scope];
  const inherited = scoped.inherited[scope].interceptors;
  const allNames = [
    ...new Set([...names, ...Object.keys(inherited), ...Object.keys(layer.interceptors ?? {})]),
  ];
  if (allNames.length === 0) return null;

  const setField = (name: string, field: Field, value: string) => {
    const entry = withEntry(layer.interceptors?.[name] ?? {}, field, value || undefined);
    const interceptors = withEntry(layer.interceptors ?? {}, name, entry);
    update(withKey(layer, "interceptors", interceptors));
  };

  const fieldSelect = (name: string, field: Field, base: InterceptorSettings) => {
    const own = layer.interceptors?.[name]?.[field];
    const fallback =
      field === "model" ? (base.model ?? "worker") : (base.thinkingLevel ?? "default");
    const options =
      field === "model" ? models : THINKING_LEVELS.map((level) => ({ id: level, label: level }));
    return (
      <select
        aria-label={`${name} ${field}`}
        value={own ?? ""}
        onChange={(e) => setField(name, field, e.target.value)}
        className={`${SELECT_CLASS} ${own ? "" : "text-muted-foreground"}`}
      >
        <option value="">inherit ({fallback})</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  };

  return (
    <>
      <SectionHeader>Interceptors</SectionHeader>
      <div className="divide-border/30 divide-y">
        {allNames.map((name) => (
          <div key={name} className="flex items-center gap-2 px-2 py-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
            {fieldSelect(name, "model", inherited[name] ?? {})}
            {fieldSelect(name, "thinking_level", inherited[name] ?? {})}
          </div>
        ))}
      </div>
    </>
  );
}
