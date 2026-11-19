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
| `scripts/hire_agent.py` | `hire` creates a checked agent file (`--install` copies it to `~/.claude/agents`); `list` shows the team; `check` validates every agent. Tests: `pytest tests`. |
| `scripts/verify.sh` | Finds how a project tests itself and runs it (mod, npm/pnpm/yarn/bun, pytest, cargo, go, make). Exit 3 = nothing found. |
| `mods/live-diff` | Pane: files being edited, +/− lines, click for the diff. |
| `mods/verify-before-done` | Adds the "verify, then `Проверка: …`" rule to every prompt. |
| `mods/task-cost` | Band with tokens and ≈ USD per task; today's total in the status line. |

## Windows: Claude Code on your computer, one command

In PowerShell (not as administrator):

```powershell
irm https://raw.githubusercontent.com/rixstilla2007-cmyk/claude-toolkit/main/setup-windows.ps1 | iex
```

It installs Git for Windows (winget) and Claude Code (official installer)
when missing, clones this toolkit to `%USERPROFILE%\claude-toolkit` (or
updates it), installs the agents and skills, and creates
`%USERPROFILE%\claude-work`. Then: `cd $HOME\claude-work; claude`.
Run the same command again to update.

## Install

For every project on this computer (copies into `~/.claude`; files that
differ are kept as `*.bak`):

macOS / Linux / Git Bash / WSL:

```bash
./install.sh
```

Windows PowerShell (5.1 or 7), from the toolkit folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Or only for one project: copy `.claude/` into that project's root.

The mods are loaded with `--plugin-dir`, one per mod:

```bash
claude --plugin-dir mods/live-diff --plugin-dir mods/verify-before-done --plugin-dir mods/task-cost
```

## Check

```bash
scripts/verify.sh mods/live-diff
```
