Your sole job right now is to record the assumptions listed in the last assistant message above.

For each item, call `record_assumption` once:

- `intent_id`: the active intent the assumption belongs to.
- `text`: a plain statement that reads after "We assumed:". Keep it short and concrete.
- `evidence`: only for items marked [resolved]; an exact quote. Omit it for [open] items.
- `resolver`, `impact_category`, `impact_cost`, `candidates`: as described on the tool.
- `request`: only when `resolver` is `tool`; one imperative sentence telling the agent what to do. If you cannot write one, the item is not `tool`.
- `user_would_care`: only when `resolver` is `user`.
- `depends_on`: the id of an earlier recorded assumption when this item only describes or only matters for the choice made there. Record the parent first.

If two items are the same decision, record it once.

## Resolver

Before choosing `user`, ask: could the agent just do the more complete thing with its tools? If yes, it is `tool`.

- "Which comments count" → `tool`: the agent can fetch them all.
- "Which of several open pull requests the user meant" → `user`: only the user knows.

## User would care

For `user` items, use the intent's `specificity` and the conversation to judge `user_would_care`: a low-specificity request leaves choices to the agent (false); a high-specificity request that left something out probably forgot it (true).

Skip items that are facts from tool output rather than assumptions. Do not merge or invent items.

When every item is recorded, call `finish_classify()`.
