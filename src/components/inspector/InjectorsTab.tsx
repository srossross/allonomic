import type { InjectorMeta } from "@/types";
import { InjectorRow } from "./InjectorRow";

interface InjectorsTabProperties {
  injectors: InjectorMeta[];
  expandedInjectorIds: Set<string>;
  onToggleExpand: (id: string) => void;
}

export function InjectorsTab({
  injectors,
  expandedInjectorIds,
  onToggleExpand,
}: InjectorsTabProperties) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1 text-xs">
        <span className="text-muted-foreground font-mono text-[10px] font-semibold tracking-wider uppercase">
          Installed Injectors ({injectors.length})
        </span>
        <span className="font-mono text-[10px] font-medium text-emerald-500">
          {injectors.filter((index) => index.status === "active").length} active
        </span>
      </div>

      {injectors.length === 0 ? (
        <div className="text-muted-foreground p-3 font-mono text-xs">No injectors installed.</div>
      ) : (
        <div className="space-y-1">
          {injectors.map((injector) => (
            <InjectorRow
              key={injector.id}
              injector={injector}
              isExpanded={expandedInjectorIds.has(injector.id)}
              onToggleExpand={() => onToggleExpand(injector.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
