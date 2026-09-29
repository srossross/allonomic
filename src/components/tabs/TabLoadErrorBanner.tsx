import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SessionLoadError } from "@/types/persistence";

interface TabLoadErrorBannerProperties {
  errors: SessionLoadError[];
  onCloseTab: () => void;
}

export function TabLoadErrorBanner({ errors, onCloseTab }: TabLoadErrorBannerProperties) {
  return (
    <div className="border-destructive/40 bg-destructive/10 flex items-start gap-2 border-b px-3 py-2 text-xs">
      <AlertCircle className="text-destructive mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        {errors.map((error, index) => (
          <div key={index} className="min-w-0">
            <div className="text-destructive font-medium">
              {error.turnIndex === null
                ? "Session failed to load"
                : `Turn ${error.turnIndex} failed to load`}
            </div>
            <pre className="text-muted-foreground text-2xs max-h-24 overflow-auto font-mono whitespace-pre-wrap select-text">
              {error.message}
            </pre>
          </div>
        ))}
      </div>
      <Button variant="destructive" size="xs" onClick={onCloseTab}>
        Close tab
      </Button>
    </div>
  );
}
