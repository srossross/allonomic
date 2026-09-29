## Post-Tool Failure

The tool call below failed. Diagnose why, using this manual, the Project Rules and the Current Settings.

- The failure is about tool usage (sandbox, permissions, wrong tool or level, project rules) → call `teach({ lesson })` with:
  - the cause, citing only the relevant settings
  - the exact tool and args to use next
- The failure is not about tool usage (e.g. a failing test or a bug in the worker's code) → call `ok()`.
