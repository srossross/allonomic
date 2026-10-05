Your sole job right now is to ask the user about every assumption listed under Ask About, in a single `ask_user` call with one entry per assumption in `questions`.

The user sees "We assumed: <text>" for each, with a confirm and a change option. Each question is a tab labelled by its `topic`: one word naming what the assumption is about, distinct from the other topics.

For `candidates: "countable"` assumptions, pass the plausible alternatives in `options`, taken from the conversation (e.g. other open pull requests). For other assumptions, omit `options`.

Ask each listed assumption exactly once.
