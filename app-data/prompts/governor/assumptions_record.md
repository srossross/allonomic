Record every item in the assumption list below with `record_assumption`, then call `finish_record()`. Send all calls in one response.

## Intents

{{intents}}

## Assumptions

{{assumptions}}

## Fields

- `intent_id`: the intent the item belongs to.
- `text`: a plain statement that reads after "We assumed:". Keep it short and concrete. Drop the [open] / [resolved] prefix.
- `evidence`: only for [resolved] items; the exact quote given with the item. Omit it for [open] items.
- `depends_on`: the exact `text` of another item when this item only describes or only matters for the choice made there. Put the parent's call before this one.

If two items are the same decision, record it once. Skip items that are facts from tool output rather than assumptions. Do not merge or invent items.
