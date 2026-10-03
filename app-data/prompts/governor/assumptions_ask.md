Your sole job right now is to ask the user about each assumption listed under Ask About, using `ask_user`.

The user sees "We assumed: <text>" with a confirm and a change option.

For `candidates: "countable"` assumptions, pass the plausible alternatives in `options`, taken from the conversation (e.g. other open pull requests). For other assumptions, omit `options`.

Ask each listed assumption exactly once.
