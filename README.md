# claude-toolkit

Personal agents, skills, scripts and mods for Claude Code.

## What is inside

| Path | What |
| --- | --- |
| `.claude/agents/critic.md` | Weaknesses-first review of ideas, plans, texts, work. Read-only. |
| `.claude/agents/verifier.md` | Runs tests / the program / the page and reports evidence. Does not fix. |
| `.claude/agents/researcher.md` | Web, docs and repo research; short brief with sources. Read-only. |
| `.claude/agents/developer.md` | Implements one scoped coding task with tests. |
| `.claude/agents/reviewer.md` | Reviews a diff for real bugs, with `path:line` and a failure scenario. Read-only. |
| `.claude/agents/debugger.md` | Reproduces a bug, finds the root cause, proposes (or applies) the fix. |
| `.claude/agents/mod-builder.md` | Builds and tests Claude Code mods. |
| `.claude/skills/verify-before-done` | Which check to run for which kind of change; the one-line report. |
| `.claude/skills/critique-first` | How to answer when shown an idea: risks first, argue, ask. |
| `.claude/skills/research-brief` | Research method and answer format. |
| `.claude/skills/mod-dev` | Mod checklist and the mods in this repo. |
| `.claude/skills/openai-api-key` | Setting `OPENAI_API_KEY` safely on Windows, macOS, Linux. |
| `.claude/skills/hire-agent` | When and how to create ("hire") a new specialist agent. |
| `.claude/skills/assemble-team` | Lead a team: split a task, pick or hire agents, run in parallel, verify, merge. |
| `.claude/skills/ig-*` | 13 Instagram skills (`/ig-reel`, `/ig-caption`, `/ig-human`, `/ig-viral`, …) from [instagram-agent-skill](https://github.com/Jakeschincariol/instagram-agent-skill) (MIT, `third_party/instagram-agent-skill`). They write; you post. Their Python tools need Python 3. Fill in `third_party/instagram-agent-skill/voice.md` and copy it to `~/.claude/instagram/voice.md`. |
| `.claude/skills/peredacha` | «Передача»: сжать разговор в `00 ПЕРЕДАЧА.md`, сделать `/clear` и продолжить в чистой сессии. |
| `.claude/hooks/no_delete.py` | PreToolUse: blocks `rm`/`Remove-Item`/`del` outside Temp, `git clean`, `git reset --hard`, `git checkout --`, `git restore`, `git stash drop`, `git branch -D`, `robocopy /MIR`. |
| `.claude/hooks/sekrety_git.py` | PreToolUse: refuses `git commit` / `git push` when the added lines hold an API key, token or private key. |
| `.claude/hooks/razmer_konteksta.py` | UserPromptSubmit: one-line hint at ~180k / 250k tokens of context and after a pause over an hour (cache expired). |
| `.claude/hooks/posle_szhatiya.py` | SessionStart (compact): after compaction, lists the files edited in the session. |
| `user/CLAUDE.md` | Global rules (Russian, never delete, facts, saving the limit, Windows, compact instructions), installed as a marked block in `~/.claude/CLAUDE.md`. |
| `user/settings-add.json` | Merged into `~/.claude/settings.json`: hooks, `cleanupPeriodDays: 3650`, no reading `.env`, `skillOverrides` (rare skills listed by name only — delete a line or use `/skills` to bring one back). |
| `scripts/install_user.py` | Does that merge: your own values win, a hook already wired is not added twice, changed files are copied to `*.bak-<date>` first. |
| `scripts/hire_agent.py` | `hire` creates a checked agent file (`--install` copies it to `~/.claude/agents`); `list` shows the team; `check` validates every agent. Tests: `pytest tests`. |
| `scripts/verify.sh` | Finds how a project tests itself and runs it (mod, npm/pnpm/yarn/bun, pytest, cargo, go, make). Exit 3 = nothing found. |
| `mods/live-diff` | Pane: files being edited, +/− lines, click for the diff. |
| `mods/verify-before-done` | Adds the "verify, then `Проверка: …`" rule to every prompt. |
| `mods/task-cost` | Band with tokens and ≈ USD per task; today's total in the status line. |
| `office/` | «Офис Claude»: a 3D office in the browser where you watch the main session and every subagent work, live. Read-only. See below. |

## Windows: Claude Code on your computer, one command

In PowerShell (not as administrator):

```powershell
irm https://raw.githubusercontent.com/rixstilla2007-cmyk/claude-toolkit/main/setup-windows.ps1 | iex
```

It installs Git for Windows and Python 3 (winget) and Claude Code (official
installer) when missing, clones this toolkit to `%USERPROFILE%\claude-toolkit` (or
updates it), installs the agents, skills and hooks, merges the settings and
rules (see `user/`), and creates
`%USERPROFILE%\claude-work`. Then: `cd $HOME\claude-work; claude`.
Run the same command again to update.

## Agent office: watch Claude work

`office/` is a 3D office in the browser. The main session sits in the
director's office on the 4th floor; each subagent walks to its room (library,
open space, meeting room, review pod), MCP calls light up the screens on the
1st floor, and the panel lists who is doing what. Click a person (or a row)
to follow them and see every step.

It only **reads** the transcripts Claude Code already writes to
`~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`), shows them at
`http://localhost:4545/` to this computer only, and changes nothing.

- Windows: double-click `office\start-office.cmd`
  (`%USERPROFILE%\claude-toolkit\office\start-office.cmd` after the
  one-command setup). Keep its window open; close it to stop.
- macOS / Linux: `node office/server.mjs`, then open the address it prints.

Then work in Claude Code as usual. The office follows the most recent
session; pick another in «Сессия». Add `?demo` to the address for a demo.

Limits: needs a Claude Code version that writes `subagents/` folders; the 3D
library (Three.js) loads from jsdelivr, so it needs internet; only Claude
Code on this computer, not cloud sessions.

Tests: `node --test tests/office/*.test.mjs` (the PowerShell server test runs
when `pwsh` is on PATH) and `node tests/office/page.check.mjs` (Playwright).

## Install

For every project on this computer (copies agents, skills and hooks into
`~/.claude`; files that differ are kept as `*.bak`). With Python 3.10+ it then
runs `scripts/install_user.py`, which wires the hooks into `settings.json` and
adds the rules to `CLAUDE.md`; without Python it only warns:

macOS / Linux / Git Bash / WSL:

```bash
./install.sh
```

Windows PowerShell (5.1 or 7), from the toolkit folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Or only for one project: copy `.claude/` into that project's root (the hooks
then stay unwired).

The mods are loaded with `--plugin-dir`, one per mod:

```bash
claude --plugin-dir mods/live-diff --plugin-dir mods/verify-before-done --plugin-dir mods/task-cost
```

## Check

```bash
scripts/verify.sh mods/live-diff
```
