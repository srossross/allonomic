import type { ConsoleEvent } from "@/types";
import { ConsoleEventRow } from "./ConsoleEventRow";

interface ConsoleTabProperties {
  consoleEvents: ConsoleEvent[];
  expandedEventIds: Set<string>;
  onToggleExpand: (id: string) => void;
}

export function ConsoleTab({
  consoleEvents,
  expandedEventIds,
  onToggleExpand,
}: ConsoleTabProperties) {
  if (consoleEvents.length === 0) {
    return (
      <div className="text-muted-foreground p-3 font-mono text-xs">
        No events logged yet. Execute a prompt to see turn execution & interception logs.
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {consoleEvents.map((event) => (
        <ConsoleEventRow
          key={event.id}
          event={event}
          isExpanded={expandedEventIds.has(event.id)}
          onToggle={() => onToggleExpand(event.id)}
        />
      ))}
    </div>
  );
}
