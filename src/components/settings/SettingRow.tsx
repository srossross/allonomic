import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";

export const SELECT_CLASS =
  "border-border/60 bg-background rounded-xs border px-1.5 py-0.5 font-mono text-xs";

interface SettingRowProperties {
  label: string;
  source: string;
  isSet: boolean;
  onReset: () => void;
  children: ReactNode;
}

export function SettingRow({ label, source, isSet, onReset, children }: SettingRowProperties) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-xs">
      <span className="text-foreground min-w-0 flex-1 truncate">{label}</span>
      <div className={isSet ? "text-foreground" : "text-muted-foreground"}>{children}</div>
      <span className="text-muted-foreground text-2xs w-16 text-right">
        {isSet ? "set here" : `from ${source}`}
      </span>
      <button
        type="button"
        onClick={onReset}
        disabled={!isSet}
        title="Reset to inherited"
        className="text-muted-foreground hover:text-foreground cursor-pointer disabled:invisible"
      >
        <RotateCcw className="size-3" />
      </button>
    </div>
  );
}

export function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground border-border/30 text-2xs mt-3 border-b px-2 pb-1 font-medium">
      {children}
    </div>
  );
}
