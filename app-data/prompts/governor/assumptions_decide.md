The agent has finished its turn. Decide whether its work satisfied the active intents.

1. Call `resolveAssumptions` for open assumptions the conversation now confirms, quoting the evidence.
2. Call `resolve_intent` for each active intent the work satisfied.
3. End with one of:
   - `atLeastOneIntentWasSatisfied()`: at least one intent was satisfied. The turn ends.
   - `returnToWorkerWithUnmetIntent({ intent_id, why })`: no intent was satisfied. `intent_id` is the active intent that is unmet; `why` tells the agent what is missing.
