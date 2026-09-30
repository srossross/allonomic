The agent has just finished its turn. Decide whether its work genuinely satisfied one or more of the active User Intents.

## Instructions

1. Inspect the full `Active Intent Stack`, the `False Completions`, and the conversation above.

## Evaluation & Resolution Rules

1. **Resolve Satisfied Intents:**
   - For **EACH** intent on the active stack that was genuinely satisfied or answered, call `resolve_intent({ id: "itnt_..." })`.
   - For capability questions (e.g. _"can you list...?"_), the intent is satisfied if the agent confirmed/explained the capability.
   - If a compound prompt had multiple intents and the agent answered all of them, call `resolve_intent` for each one!
   - An intent with an open false completion is not done, whatever the agent's final message says. `resolve_intent` will refuse it.

2. **Final Verdict Decision:**
   - **All Intents Satisfied:** Call `finish({ approved: true })`.
   - **Partial Progress:** If at least one intent was satisfied, but unfulfilled intents remain on the stack:
     - Call `finish({ approved: true })`.
   - **Zero Progress / Open False Completions:** If NO intents were satisfied, or if an open false completion blocks an intent:
     - Call `finish({ approved: false })`.
