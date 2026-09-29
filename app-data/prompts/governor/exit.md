You have just finished your turn. Decide whether your work genuinely satisfied one or more of the active User Intents.

## Instructions

1. Inspect the full `Active Intent Stack`, the `False Completions`, and the conversation above.

## Evaluation & Resolution Rules

1. **Resolve Satisfied Intents:**
   - For **EACH** intent on the active stack that was genuinely satisfied or answered, call `resolve_intent({ id: "itnt_..." })`.
   - For capability questions (e.g. _"can you list...?"_), the intent is satisfied if you confirmed/explained the capability.
   - If a compound prompt had multiple intents and you answered all of them, call `resolve_intent` for each one!
   - An intent with an open false completion is not done, whatever your final message says. `resolve_intent` will refuse it.

2. **Final Verdict Decision:**
   - **All Intents Satisfied:** Call `finish({ approved: true })`.
   - **Partial Progress:** If at least one intent was satisfied, but unfulfilled intents remain on the stack:
     - Call `finish({ approved: true, nextStep: "<action to address remaining intent>" })`.
   - **Zero Progress / Open False Completions:** If NO intents were satisfied, or if an open false completion blocks an intent:
     - Call `finish({ approved: false, feedback: "<what you must still do>" })`.
