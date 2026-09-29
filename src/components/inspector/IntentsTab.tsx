import type { UserIntent, FalseCompletion } from "@/core/governor/types";
import { IntentRow } from "./IntentRow";
import { FalseCompletionRow } from "./FalseCompletionRow";

interface IntentsTabProperties {
  intentStack: UserIntent[];
  completedIntents: UserIntent[];
  falseCompletions: FalseCompletion[];
  onSelect: (intentId: string, falseCompletionId?: string) => void;
}

export function IntentsTab({
  intentStack,
  completedIntents,
  falseCompletions,
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
          {falseCompletions
            .filter((falseCompletion) => falseCompletion.intent_id === intent.id)
            .map((falseCompletion) => (
              <FalseCompletionRow
                key={falseCompletion.id}
                falseCompletion={falseCompletion}
                onSelect={() => onSelect(intent.id, falseCompletion.id)}
              />
            ))}
        </div>
      ))}
    </div>
  );
}
