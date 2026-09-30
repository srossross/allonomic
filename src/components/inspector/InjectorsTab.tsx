import type { InterceptorInfo } from "@/core/graph/types";
import type { InterceptorSettings } from "@/core/config/settings";
import type { ModelOption } from "@/types";
import { InjectorRow } from "./InjectorRow";

interface InjectorsTabProperties {
  interceptors: InterceptorInfo[];
  error?: string;
  expandedNames: Set<string>;
  onToggleExpand: (name: string) => void;
  models: ModelOption[];
  settings: Record<string, InterceptorSettings>;
  onSetSettings?: (name: string, settings: InterceptorSettings) => void;
}

export function InjectorsTab({
  interceptors,
  error,
  expandedNames,
  onToggleExpand,
  models,
  settings,
  onSetSettings,
}: InjectorsTabProperties) {
  return (
    <div className="space-y-2">
      {error && (
        <div className="text-destructive p-3 font-mono text-xs">
          Failed to load interceptors: {error}
        </div>
      )}
      <div className="flex items-center justify-between px-1 text-xs">
        <span className="text-muted-foreground text-2xs font-mono font-semibold tracking-wider uppercase">
          Interceptors ({interceptors.length})
        </span>
        <span className="text-2xs font-mono font-medium text-emerald-500">
          {interceptors.filter((interceptor) => interceptor.isEnabled).length} active
        </span>
      </div>

      {interceptors.length === 0 ? (
        <div className="text-muted-foreground p-3 font-mono text-xs">No interceptors.</div>
      ) : (
        <div className="space-y-1">
          {interceptors.map((interceptor) => (
            <InjectorRow
              key={interceptor.name}
              interceptor={interceptor}
              isExpanded={expandedNames.has(interceptor.name)}
              onToggleExpand={() => onToggleExpand(interceptor.name)}
              models={models}
              settings={settings[interceptor.name] ?? {}}
              onSetSettings={onSetSettings && ((next) => onSetSettings(interceptor.name, next))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
