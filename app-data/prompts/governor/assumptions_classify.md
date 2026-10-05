Your sole job right now is to classify the assumptions listed under Open Assumptions.

For each one, call `add_to_assumption` once. Send all calls in one response.

- `id`: the assumption's id.
- `resolver`, `impact_category`, `impact_cost`, `candidates`: as described on the tool.
- `request`: only when `resolver` is `tool`; one imperative sentence telling the agent what to do. If you cannot write one, the item is not `tool`.
- `user_would_care`: only when `resolver` is `user`.

## Resolver

Before choosing `user`, ask: could the agent just do the more complete thing with its tools? If yes, it is `tool`.

- "Which comments count" → `tool`: the agent can fetch them all.
- "Which of several open pull requests the user meant" → `user`: only the user knows.

## User would care

`user_would_care` is true only when both hold:

1. The choice changes what the user gets: the outcome they asked for, or something they will see, depend on, or have to undo. A choice that only changes how the agent got there is false.
2. The conversation shows the user has a stake in this kind of choice: they constrained it or a neighbouring choice, discussed it, set it up earlier, or the intent's `specificity` is high and this was left out.

Otherwise it is false. A low-specificity request leaves the choice to the agent. Whether the user cares depends on this user and this conversation, not on the kind of choice.
