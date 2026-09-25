import { Shield } from "lucide-react";

export interface ConstraintsTabProps {
  globalConstraints?: string[];
}

export function ConstraintsTab({ globalConstraints = [] }: ConstraintsTabProps) {
  if (globalConstraints.length === 0) {
    return <div className="text-muted-foreground p-3 text-xs">No active constraints.</div>;
  }

  return (
    <div className="space-y-0.5">
      {globalConstraints.map((constraint, index) => (
        <div
          key={index}
          className="text-foreground hover:bg-muted/40 flex items-start gap-2 rounded-xs px-2 py-1.5 text-xs transition-colors"
        >
          <Shield className="text-muted-foreground mt-0.5 size-3.5 shrink-0 opacity-70" />
          <span className="leading-snug">{constraint}</span>
        </div>
      ))}
    </div>
  );
}
