---
name: mod-dev
description: Checklist for creating, testing and shipping a Claude Code mod (pane, band, status line, toast, slash command, prompt or tool-call hook), and the mods already in this toolkit. Use with the plugin-authoring skill whenever building or fixing a mod.
---

# Mod development checklist

Load the built-in `plugin-authoring` skill first: it gives this build's folder
for mods, its type definitions and the examples. This list is what to do with
them.

1. **Pick the shape** from the request (plugin-authoring's table): pane for
   anything kept beside the chat; band above the prompt for a short result;
   `$.ui.status` for a counter at the bottom; `prompt.submit` with `context`
   to add a rule to every prompt; `tool.call` to watch or change tool calls.
2. **Files:** `.claude-plugin/plugin.json`, `hooks/hooks.json`
   (`{ "modules": ["./register.tsx"] }`), `hooks/register.tsx`, and
   `types/index.d.ts` declaring every `$.state` value (named as `"types"` in
   plugin.json). Version stored arrays with `atom(ref, init, { shape: 'x-1' })`.
3. **Test** in `tests/*.test.tsx` with `claude-code/testing`: stand in for the
   engine with `on('<event>', ...)`, mount the UI on every surface, press
   buttons by `key`.
4. **Check:** `claude plugin validate <mod>`, `claude plugin test <mod>`, and a
   type-check (`tsc -p <mod>` once the engine laid its types).
5. **Live:** the mod loads when the turn ends. Only the person can confirm a
   pane is on screen; say so instead of claiming it.

Writing long files through a Bash heredoc can trip the shell safety check;
write them with the Write tool.

## Mods in this toolkit (`mods/`)

| Mod | What it does |
| --- | --- |
| `live-diff` | Pane: files Claude edits (Edit/Write), +/− lines, click for the diff. `/live-diff` reopens it. |
| `verify-before-done` | Adds the "verify, then one line `Проверка: …`" rule to every prompt. |
| `task-cost` | Band after each task: tokens and ≈ USD (from `/cost`); status line: today's total. |

Known limits: `live-diff` does not see changes made through the shell;
`task-cost` counts "today" in the machine's time zone.
