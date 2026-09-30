import { useState } from "react";
import type { SettingsLayer } from "@/core/config/settings";
import { SETTINGS_SCOPES, type SettingsScope } from "@/core/config/scopedSettings";
import { Checkbox } from "@/components/ui/checkbox";
import { useInterceptors } from "@/components/inspector/useInterceptors";
import { AVAILABLE_MODES, GOVERNOR_MODES, THINKING_LEVELS, type ModelOption } from "@/types";
import { InterceptorsSection } from "./InterceptorsSection";
import { SandboxSection } from "./SandboxSection";
import { SELECT_CLASS, SettingRow } from "./SettingRow";
import { ToolsSection } from "./ToolsSection";
import { sourceOf, withKey } from "./layerEdit";
import { useScopedSettings } from "./useScopedSettings";

interface SettingsPanelProperties {
  workspacePath?: string;
  sessions: Array<{ id: string; title: string }>;
  models: ModelOption[];
  onSaved: () => Promise<void>;
}

type Option = { id: string; label: string };

const asOptions = (ids: readonly string[]): Option[] => ids.map((id) => ({ id, label: id }));

export function SettingsPanel({
  workspacePath,
  sessions,
  models,
  onSaved,
}: SettingsPanelProperties) {
  const [scope, setScope] = useState<SettingsScope>("user");
  const [pickedSessionId, setPickedSessionId] = useState<string>();
  const sessionId = sessions.some((s) => s.id === pickedSessionId)
    ? pickedSessionId
    : sessions[0]?.id;
  const { scoped, save } = useScopedSettings(workspacePath, sessionId, onSaved);
  const { interceptors } = useInterceptors(workspacePath, sessionId, "");
  const canEdit = scope !== "session" || sessionId !== undefined;

  const header = (
    <div className="border-border/60 flex h-9 shrink-0 items-center gap-2 border-b px-3">
      <h1 className="text-sm font-semibold">Settings</h1>
      <div className="ml-auto flex items-center gap-0.5">
        {SETTINGS_SCOPES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            className={`cursor-pointer rounded-xs px-2 py-0.5 text-xs capitalize transition-colors ${
              scope === s
                ? "bg-muted/50 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      {scope === "session" && sessions.length > 0 && (
        <select
          aria-label="Session"
          value={sessionId}
          onChange={(e) => setPickedSessionId(e.target.value)}
          className={`${SELECT_CLASS} max-w-40 truncate`}
        >
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      )}
    </div>
  );

  if (!scoped || !canEdit) {
    return (
      <div className="bg-background flex min-h-0 flex-1 flex-col">
        {header}
        {!canEdit && <p className="text-muted-foreground p-3 text-xs">No open sessions.</p>}
      </div>
    );
  }

  const layer = scoped.layers[scope];
  const inherited = scoped.inherited[scope];
  const update = (next: SettingsLayer) => void save(scope, next);

  const row = <K extends keyof SettingsLayer>(key: K, label: string, control: React.ReactNode) => (
    <SettingRow
      key={key}
      label={label}
      source={sourceOf(scoped, scope, (l) => l[key])}
      isSet={layer[key] !== undefined}
      onReset={() => update(withKey(layer, key, undefined))}
    >
      {control}
    </SettingRow>
  );

  const selectRow = (
    key: "execution_mode" | "governor_mode" | "model" | "thinking_level",
    label: string,
    value: string,
    options: Option[]
  ) =>
    row(
      key,
      label,
      <select
        aria-label={label}
        value={value}
        onChange={(e) => update({ ...layer, [key]: e.target.value })}
        className={SELECT_CLASS}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );

  const checkboxRow = (key: "network_access" | "teacher", label: string, isChecked: boolean) =>
    row(
      key,
      label,
      <Checkbox
        checked={isChecked}
        onCheckedChange={(checked) => update({ ...layer, [key]: checked })}
      />
    );

  const model = layer.model ?? inherited.model;
  const modelOptions = models.some((m) => m.id === model)
    ? models
    : [...models, { id: model, label: model }];
  const section = { scoped, scope, update };

  return (
    <div className="bg-background flex min-h-0 flex-1 flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="divide-border/30 divide-y">
          {selectRow(
            "execution_mode",
            "Execution mode",
            layer.execution_mode ?? inherited.executionMode,
            AVAILABLE_MODES
          )}
          {checkboxRow(
            "network_access",
            "Network access",
            layer.network_access ?? inherited.networkAccess
          )}
          {selectRow(
            "governor_mode",
            "Governor mode",
            layer.governor_mode ?? inherited.governorMode,
            asOptions(GOVERNOR_MODES)
          )}
          {checkboxRow("teacher", "Teacher", layer.teacher ?? inherited.teacherEnabled)}
          {selectRow("model", "Model", model, modelOptions)}
          {selectRow(
            "thinking_level",
            "Thinking level",
            layer.thinking_level ?? inherited.thinkingLevel,
            asOptions(THINKING_LEVELS)
          )}
        </div>
        <ToolsSection {...section} />
        <InterceptorsSection {...section} names={interceptors.map((i) => i.name)} models={models} />
        <SandboxSection {...section} />
      </div>
    </div>
  );
}
