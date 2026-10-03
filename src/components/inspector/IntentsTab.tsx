import type { UserIntent, Assumption } from "@/core/governor/types";
import { IntentRow } from "./IntentRow";
import { AssumptionRow } from "./AssumptionRow";

interface IntentsTabProperties {
  intentStack: UserIntent[];
  completedIntents: UserIntent[];
  assumptions: Assumption[];
  onSelect: (intentId: string, assumptionId?: string) => void;
}

export function IntentsTab({
  intentStack,
  completedIntents,
  assumptions,
  onSelect,
}: IntentsTabProperties) {
  if (intentStack.length === 0 && completedIntents.length === 0) {
    return <div className="text-muted-foreground p-3 text-xs">No active or completed intents.</div>;
  }

  const rows = [
    ...intentStack.toReversed().map((intent) => ({ intent, isDone: false })),
    ...completedIntents.toReversed().map((intent) => ({ intent, isDone: true })),
  ];

  return (
    <div className="space-y-0.5">
      {rows.map(({ intent, isDone }, index) => (
        <div key={intent.id || `${isDone ? "done" : "active"}-${index}`}>
          <IntentRow intent={intent} isDone={isDone} onSelect={() => onSelect(intent.id)} />
          {assumptions
            .filter((assumption) => assumption.intent_id === intent.id)
            .map((assumption) => (
              <AssumptionRow
                key={assumption.id}
                assumption={assumption}
                onSelect={() => onSelect(intent.id, assumption.id)}
              />
            ))}
        </div>
      ))}
    </div>
  );
}
