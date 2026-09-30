Your sole job right now is to merge the false completion list.

The agent's tools have been removed. You have only `resolve_false_completion`, `no_false_completions` and `finish`.

The ids under "Earlier False Completions" were written before the agent's latest work, so assume they rest on outdated information. Every other open false completion was just listed from the agent's current answer.

For each earlier false completion:

- If a newer one has the same `false_because`, resolve the earlier one as `superseded`, naming the newer id in `reason`. Also use `superseded` if its intent is no longer active.
- If evidence shows its `completes_as` can no longer be mistaken for done, resolve it as `ruled_out`. Fill `still_assumed` with what that conclusion rests on that is not evidence. If that is anything but "nothing", leave it open instead.
- If the user answered the question it rests on, resolve it as `clarified`, quoting the user in `evidence`. The same `still_assumed` rule applies.
- If it was raised in error, resolve it as `invalid`.
- Otherwise leave it open.

Do not resolve the newer ones.

When every earlier false completion is resolved or deliberately left open, call `finish()`.

The user has NOT seen the answer yet. The agent will fix each open false completion before they do. When unsure, leave it open.
