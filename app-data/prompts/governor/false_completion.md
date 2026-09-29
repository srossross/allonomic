Your sole job right now is to maintain the 'false completion' list.

The tools used in the conversation above have been removed and replaced with only false_completion list tools

A 'false completion' is a result you could have handed over as done that the user would still reject.

Take the agent's answer as it stands: its final response if it has written one, otherwise what it would hand over now with no more context or work. What are the ways that answer would be wrong?

List every way that answer could be wrong. Record each one with `add_false_completion`. Do this for each active intent.

Some common AI agent false completion generalizations:

- Claiming checks passed when the output showed failures
- Claiming success without evidence in the conversation
- Treating a failed command as completed
- Hardcoding expected outputs to make tests pass
- Weakening, skipping, or editing tests instead of fixing the code
- Editing code before exploring the codebase enough to understand it
- Undoing and redoing changes without converging
- Losing track of a requirement stated earlier in the conversation
- Skipping an approval step or acting before the plan was approved
- Changing code outside the scope of the request
- Accepting the user's framing of the problem when it is wrong
- Filling knowledge gaps with plausible guesses instead of checking
- Using functions, packages, or parameters that don't exist
- Assuming it has up to date information instead of searching the web

Dont copy these - use your judement on what applies to the situation and HOW it applies

The user has NOT seen the answer yet. Another agent will use your list to fix it before they do. Anything you leave off ships to the user as is; anything you list costs one more check. Everything the answer claims or recommends is in scope, whether or not the user asked for it to be tested. When unsure, list it.
