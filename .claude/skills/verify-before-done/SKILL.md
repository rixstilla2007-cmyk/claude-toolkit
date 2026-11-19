---
name: verify-before-done
description: Checklist for proving a task works before calling it done — which check to run for code, a web page, a script, a config or a document, and how to report it in one line. Use at the end of any task that changed something.
---

# Verify before saying "done"

A task is done only when its result was checked the way a user would check it.

## Pick the check

| What changed | Check |
| --- | --- |
| Code with tests | Run the related tests, then the suite if cheap. `scripts/verify.sh` in this toolkit finds and runs the project's tests. |
| Code without tests | Run the program or a short script that exercises the change. |
| Web page / UI | Start it, open it (Playwright: `require('playwright')`), screenshot or read the DOM. |
| CLI / install | Run `--version` / `--help` and one real command. |
| Config / settings | Load it with the tool that reads it (validate, dry-run, lint). |
| Document / text | Re-read against the request; check every link and number. |
| Something on the user's machine | You cannot check it: say so. |

For anything non-trivial, hand the claim to the `verifier` agent for an
independent run.

## Report

End the answer with one line:

- `Проверка: <what was run and what it showed>` — e.g. `Проверка: npm test — 42 passed`.
- `Проверка: не проверено — <why>` when no check was possible.

Never write that something passed without having run it. Partial checks are
named as partial.
