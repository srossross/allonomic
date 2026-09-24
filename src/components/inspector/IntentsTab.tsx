import type { UserIntent } from "@/interceptor-agents/governor/types";
import { IntentRow } from "./IntentRow";

interface IntentsTabProperties {
  intentStack: UserIntent[];
  completedIntents: UserIntent[];
  reframedMap: Record<string, string>;
  expandedKeys: Set<string>;
  onToggleExpand: (key: string) => void;
}

export function IntentsTab({
  intentStack,
  completedIntents,
  reframedMap,
  expandedKeys,
  onToggleExpand,
}: IntentsTabProperties) {
  if (intentStack.length === 0 && completedIntents.length === 0) {
    return <div className="text-muted-foreground p-3 text-xs">No active or completed intents.</div>;
  }

  return (
    <div className="space-y-0.5">
      {intentStack.toReversed().map((intent, index) => {
        const key = intent.id || intent.description;
        const displayText = reframedMap[key] || intent.description;
        return (
          <IntentRow
            key={key || `active-${index}`}
            intent={intent}
            isDone={false}
            displayText={displayText}
            isExpanded={expandedKeys.has(key)}
            onToggle={() => onToggleExpand(key)}
          />
        );
      })}

      {completedIntents.toReversed().map((intent, index) => {
        const key = intent.id || intent.description;
        const displayText = reframedMap[key] || intent.description;
        return (
          <IntentRow
            key={key || `done-${index}`}
            intent={intent}
            isDone={true}
            displayText={displayText}
            isExpanded={expandedKeys.has(key)}
            onToggle={() => onToggleExpand(key)}
          />
        );
      })}
    </div>
  );
}
