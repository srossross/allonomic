import { ChevronDown } from "lucide-react";
import type { InterceptorInfo } from "@/core/graph/types";
import type { InterceptorSettings } from "@/core/config/settings";
import { THINKING_LEVELS, type ModelOption } from "@/types";

interface InjectorRowProperties {
  interceptor: InterceptorInfo;
  isExpanded: boolean;
  onToggleExpand: () => void;
  models: ModelOption[];
  settings: InterceptorSettings;
  onSetSettings?: (settings: InterceptorSettings) => void;
}

export function InjectorRow({
  interceptor,
  isExpanded,
  onToggleExpand,
  models,
  settings,
  onSetSettings,
}: InjectorRowProperties) {
  const { name, description, modelName, isEnabled, hooks } = interceptor;
  const modelChoices =
    settings.model && models.every((m) => m.id !== settings.model)
      ? [...models, { id: settings.model, label: settings.model }]
      : models;
  const thinkingLevels = models.find((m) => m.id === modelName)?.thinking ?? THINKING_LEVELS;
  return (
    <div className={`flex flex-col overflow-hidden rounded-xs ${isEnabled ? "" : "opacity-60"}`}>
      <button
        type="button"
        onClick={onToggleExpand}
        className={`group flex w-full cursor-pointer items-start gap-2 rounded-xs px-2 py-2 text-left transition-colors select-none ${
          isExpanded ? "bg-muted/50" : "hover:bg-muted/30"
        }`}
      >
        <div className="shrink-0 pt-1">
          <span className="relative flex h-2 w-2">
            {isEnabled && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${isEnabled ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
            ></span>
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-foreground font-mono text-xs font-medium">{name}</span>
            {modelName && (
              <span className="bg-muted py-0.2 text-muted-foreground text-2xs rounded-xs px-1 font-mono">
                {modelName}
              </span>
            )}
            {settings.thinkingLevel && (
              <span className="bg-muted py-0.2 text-muted-foreground text-2xs rounded-xs px-1 font-mono">
                thinking: {settings.thinkingLevel}
              </span>
            )}
            <span
              className={`text-2xs ml-auto pr-1 font-medium ${isEnabled ? "text-emerald-500" : "text-muted-foreground"}`}
            >
              {isEnabled ? "active" : "off"}
            </span>
          </div>

          <p className="text-muted-foreground mt-1 text-xs leading-snug">{description}</p>
        </div>

        <ChevronDown
          className={`text-muted-foreground mt-1 size-3.5 shrink-0 transition-transform duration-150 ${
            isExpanded ? "" : "-rotate-90 opacity-50 group-hover:opacity-100"
          }`}
        />
      </button>

      {isExpanded && (
        <div className="border-primary/40 bg-muted/25 mx-2 mt-0.5 mb-2 space-y-1.5 rounded-xs border-l-2 p-2.5 text-xs select-text">
          <div className="text-muted-foreground text-2xs mb-1 font-semibold tracking-wider uppercase">
            Model
          </div>
          <select
            value={settings.model ?? ""}
            disabled={!onSetSettings}
            onChange={(e) => onSetSettings?.({ ...settings, model: e.target.value || undefined })}
            className="border-border/60 bg-background text-foreground w-full rounded-xs border px-1.5 py-1 font-mono text-xs"
          >
            <option value="">Worker model</option>
            {modelChoices.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>

          <div className="text-muted-foreground text-2xs mt-2 mb-1 font-semibold tracking-wider uppercase">
            Thinking
          </div>
          <div className="flex gap-1">
            {[undefined, ...thinkingLevels].map((level) => (
              <button
                key={level ?? "default"}
                type="button"
                disabled={!onSetSettings}
                onClick={() => onSetSettings?.({ ...settings, thinkingLevel: level })}
                className={`text-2xs cursor-pointer rounded-xs px-1.5 py-0.5 transition-colors ${
                  settings.thinkingLevel === level
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted/40"
                }`}
              >
                {level ?? "Default"}
              </button>
            ))}
          </div>

          <div className="text-muted-foreground text-2xs mt-2 mb-1 font-semibold tracking-wider uppercase">
            Hooks ({hooks.length})
          </div>
          {hooks.map(({ hook, description: hookDescription }) => (
            <div key={hook} className="border-border/60 border-l pl-2">
              <span className="text-primary/80 text-2xs font-mono">{hook}</span>
              {hookDescription && (
                <p className="text-muted-foreground text-2xs mt-0.5 leading-tight">
                  {hookDescription}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
