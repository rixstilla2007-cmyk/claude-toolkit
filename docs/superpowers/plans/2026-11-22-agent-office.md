# Agent Office Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web page "Офис Claude" that shows, live, what the main Claude Code session and each of its subagents is doing, inside the approved 3D office.

**Architecture:** Claude Code already writes every step to `~/.claude/projects/<project>/<session>.jsonl` and each subagent's steps to `<session>/subagents/agent-<id>.jsonl`. A tiny read-only local server (PowerShell on Windows, Node elsewhere, same API) serves those bytes; the page parses them with `feed.js` into a list of workers and drives the 3D office from it.

**Tech Stack:** Plain JS (no build), Three.js 0.128.0 from jsdelivr, Node ≥ 18 (`node:test`, `node:http`), Windows PowerShell 5.1 / PowerShell 7 (`System.Net.HttpListener`), Playwright for the page check.

**Spec:** `docs/superpowers/specs/2026-11-22-agent-office-design.md`

## Global Constraints

- Read only: never write, rename or lock anything under the projects root; open files with shared read/write.
- Listen on `127.0.0.1` only; port 4545, next free up to 4555.
- Reject any request whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` (403). No CORS headers.
- Projects root: `$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`.
- `/api/read`: `file` relative, no `..`, ends `.jsonl`, resolves inside root, else 400; max 4 MB per reply, cut at the last `\n`.
- `/api/sessions`: at most 20 main transcripts (`*/*.jsonl`), newest first.
- Page polls once a second; `?demo` or no sessions plays the mockup's scripted demo with a «Демо» badge.
- Task title: first line of the user message, max 60 characters.
- All user-facing text in Russian, as in the mockup.

## Review Focus

1. A transcript line cut in the middle of writing (no trailing `\n` yet) must not be lost or double-counted on the next poll. → Task 2 `read cuts at last newline`, Task 1 `parseLines skips broken line`.
2. A huge transcript (10 MB+) must load without freezing: it arrives in 4 MB chunks. → Task 2 `read caps at 4 MB`.
3. User folder with Cyrillic letters (`C:\Users\Рикс`) and spaces. → Task 2/3 fixture root contains `Рикс dir`.
4. Two subagents of the same type at once must be two people, not one. → Task 1 `second researcher is #2`.
5. A background subagent (`async_launched`) must keep working until its own transcript ends. → Task 1 `async agent done only at end_turn`.

---

### Task 1: `feed.js` — transcript lines → workers

**Files:**
- Create: `office/feed.js`
- Test: `tests/office/feed.test.mjs`

**Interfaces:**
- Produces (classic script: sets `globalThis.OfficeFeed`, and `module.exports` when `module` exists):
  - `parseLines(text: string) -> object[]` — one object per JSON line, broken lines skipped.
  - `describeTool(name: string, input: object) -> {kind: 'work'|'skill'|'mcp', status: string, tool: string, mcp: string}`
  - `roomFor(type: string) -> 'library'|'meeting'|'review'|'workshop'`
  - `createFeed() -> Feed` with
    - `addMain(entry: object): void`
    - `addSub(file: string, entry: object): void` (`file` is the `agent-<id>.jsonl` path)
    - `snapshot() -> {task: {title: string, at: number, done: boolean} | null, workers: Worker[]}`
  - `Worker = {key, type, name, room, kind: 'idle'|'work'|'skill'|'mcp'|'done', status, tool, mcp, since: number /*ms*/, log: {t: number, text: string, tool: string}[]}`; the main session is always `workers[0]` with `key: 'me'`, `type: 'main'`, `name: 'Я (Claude)'`, `room: 'office'`.

Rules (from the spec): user message with string content (or text blocks) that is not `isMeta` and does not start with `<command-`, `<local-command`, `<task-notification` is a new task; `Agent`/`Task` tool_use creates a worker keyed by tool_use id; sub file linked by its first user message text === tool input `prompt`, fallback `toolUseResult.agentId`; worker done on its tool_result unless `toolUseResult.status === 'async_launched'`, or on its own assistant entry with `stop_reason: 'end_turn'`; main idle (`'Жду задачу'`, task.done) on assistant `end_turn` with no open tool_use. Rooms: library ← researcher, Explore, claude-code-guide, web-fetch; meeting ← critic, Plan; review ← reviewer, verifier; workshop ← everything else. MCP display name: second `__` segment with `^plugin_[^_]+_` removed.

- [ ] **Step 1: Write the failing tests** (build entries inline as objects shaped like the real transcript: `{type:'user'|'assistant', timestamp, message:{content}, toolUseResult?}`)

```js
test('user prompt starts a task', () => { /* title 'Составь план монетизации Instagram' (first line, ≤60), me.status === 'Читаю задачу' */ });
test('Agent call creates a researcher in the library', () => { /* workers[1]: type 'researcher', room 'library', kind 'work'; me.status startsWith 'Поручаю researcher' */ });
test('sub file is linked by prompt and shows its steps', () => { /* addSub(...Read README.md) → worker.status === 'Читает README.md', log.length === 1 */ });
test('mcp call shows the service', () => { /* mcp__plugin_small-business_gmail__search_threads → kind 'mcp', mcp 'gmail' */ });
test('Agent result finishes the worker', () => { /* kind 'done', status 'Готово' */ });
test('async agent done only at end_turn', () => { /* async_launched result → still 'work'; sub assistant end_turn → 'done' */ });
test('second researcher is #2', () => { /* two open researcher calls → names 'researcher', 'researcher #2' */ });
test('end_turn with nothing open makes me idle', () => { /* me.kind 'idle', status 'Жду задачу', task.done === true */ });
test('Skill in main is a skill step', () => { /* me.kind 'skill', status 'Скилл assemble-team' */ });
test('tool results and meta messages are not tasks', () => { /* task stays null */ });
test('unknown type goes to the open space', () => { assert.equal(roomFor('claude-security:scan-researcher'), 'workshop'); });
test('parseLines skips broken line', () => { assert.equal(parseLines('{"a":1}\n{"b":\n{"c":3}\n').length, 2); });
```

- [ ] **Step 2: Run** `node --test tests/office/` — Expected: FAIL (`Cannot find module`).
- [ ] **Step 3: Implement `office/feed.js`** per the Interfaces block and rules above. Status texts: Read → `Читает <basename>`, Edit/Write/MultiEdit/NotebookEdit → `Правит <basename>`, Bash → `input.description` or first 40 chars of command, Grep/Glob → `Ищет: <pattern>`, WebSearch → `Ищет в интернете: <query>`, WebFetch → `Читает сайт <host>`, TodoWrite/Task* (not Task itself) → `Обновляет план`, Skill → `Скилл <skill>`, mcp → `<Service>: <tool>`, other → tool name.
- [ ] **Step 4: Run** `node --test tests/office/` — Expected: all pass.
- [ ] **Step 5: Commit** `git add office/feed.js tests/office/feed.test.mjs && git commit -m "Add office feed parser"`

### Task 2: `server.mjs` — read-only Node server

**Files:**
- Create: `office/server.mjs`
- Create: `tests/office/server-suite.mjs` (shared assertions), `tests/office/server.test.mjs`

**Interfaces:**
- Produces: `export async function startServer({root: string, port?: number = 4545, dir?: string /* folder with index.html, feed.js */}) -> {port: number, close(): Promise<void>}`; run directly (`node office/server.mjs`) it uses the spec root and prints `Офис: http://localhost:<port>/`.
- Produces: `export async function serverSuite(t, base: string, root: string)` in `server-suite.mjs` — the HTTP assertions, reused by Task 3.
- API: `GET /`, `GET /feed.js`, `GET /api/sessions -> [{file, project, mtime, size, subs: [{file, size}]}]`, `GET /api/read?file=&from= -> {text, next}`.

- [ ] **Step 1: Write the failing tests**: fixture root in `os.tmpdir()` under a folder named `Рикс dir/projects` with two projects, a main file, a `subagents/agent-a1.jsonl`, and a 5 MB file. Assertions in `serverSuite`:
  - `sessions newest first, max 20, lists subs` (create 22 mains; expect 20, first is newest; sub file listed).
  - `read cuts at last newline` (file ends `"{...}\n{\"partial"`: `text` ends with `\n`, `next` === byte length up to it; second read from `next` returns `''` and same `next`).
  - `read caps at 4 MB` (5 MB file: first `text` ≤ 4 MB, then the rest).
  - `bad paths are 400` (`../x.jsonl`, `/etc/passwd`, `a/b.txt`, `%2e%2e/x.jsonl`).
  - `wrong Host is 403` (request with header `Host: evil.example:PORT`).
  - `serves index and feed.js`.
  - In `server.test.mjs` only: `busy port moves to next` (occupy 4545 → server reports 4546).
- [ ] **Step 2: Run** `node --test tests/office/` — Expected: FAIL.
- [ ] **Step 3: Implement `startServer`** with `node:http`, `fs.promises`; byte offsets via `fs.open` + `read`; path check: `path.resolve(root, file)` startsWith `root + path.sep`.
- [ ] **Step 4: Run** `node --test tests/office/` — Expected: pass.
- [ ] **Step 5: Commit** `git commit -m "Add office server (Node)"`

### Task 3: `server.ps1` — same server for Windows

**Files:**
- Create: `office/server.ps1`, `office/start-office.cmd`
- Test: `tests/office/server-ps.test.mjs`

**Interfaces:**
- Consumes: `serverSuite` from Task 2.
- Produces: `server.ps1 [-Port 4545] [-Root <projects dir>] [-NoBrowser]`, prints `Офис: http://localhost:<port>/`, same API and rules; opens the browser unless `-NoBrowser`. `start-office.cmd` runs `powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"`.
- Must run on Windows PowerShell 5.1: no `??`, no ternary, no `-AsHashtable`; `[System.IO.File]::Open(path, Open, Read, ReadWrite)`; JSON via `ConvertTo-Json -Compress -Depth 4`, UTF-8 bytes on the wire.

- [ ] **Step 1: Write the failing test**: spawn `pwsh -NoProfile -File office/server.ps1 -Port <free> -Root <fixture> -NoBrowser`, wait for the `Офис:` line, run `serverSuite`; `test.skip` when `pwsh` is not on PATH.
- [ ] **Step 2: Install pwsh 7 into the scratchpad** for this check only (GitHub release tarball), put it on PATH; run the test — Expected: FAIL.
- [ ] **Step 3: Implement `server.ps1`** with `HttpListener` on `http://127.0.0.1:<port>/` and `http://localhost:<port>/`.
- [ ] **Step 4: Run** `node --test tests/office/` with pwsh on PATH — Expected: pass (and skips cleanly without it).
- [ ] **Step 5: Commit** `git commit -m "Add office server for Windows"`

### Task 4: `index.html` — live office

**Files:**
- Create: `office/index.html` (from the approved mockup `office-3d.html`, version 2)
- Test: `tests/office/page.check.mjs` (Playwright script, not part of `node --test`)

**Interfaces:**
- Consumes: `OfficeFeed` (Task 1), the HTTP API (Task 2).
- Keeps from the mockup: building, rooms, routes, labels, panel, drawer, demo script (now used only in demo mode).
- Changes: the cast is dynamic. The fixed roster (me + 10 known types) stands in the lounge when idle; every `Worker` from `snapshot()` maps to a character (`type` → roster character; extra instance → copy named `<type> #2` that arrives by lift and leaves after `done`; unknown type → colour from a hash of the name). A worker's target place: `room` while working, MCP → `outside:<screen>` (four screens, first-come; label = service name), `skill` for me → `office:shelf`, done/idle → `lounge` (me → `office:desk`). Panel header gets a «Сессия» `<select>` (Авто + the 20 sessions). Demo badge «Демо» when in demo mode. Three.js stays on jsdelivr 0.128.0.

- [ ] **Step 1: Write the check**: start `startServer` on a temp fixture root, open the page in Chromium (SwiftShader), append lines over time (user prompt → Agent researcher → sub Read README.md → mcp vidIQ → result); assert panel rows show `Читаю задачу`, then `researcher` with `Читает README.md`, then `Внешний сервис`, then `Готово`; assert no `pageerror`; screenshot.
- [ ] **Step 2: Run** `node tests/office/page.check.mjs` — Expected: FAIL (no `office/index.html`).
- [ ] **Step 3: Build `office/index.html`** from the mockup with the changes above.
- [ ] **Step 4: Run** the check — Expected: all assertions pass, no page errors; look at the screenshot.
- [ ] **Step 5: Commit** `git commit -m "Add live 3D office page"`

### Task 5: Docs and launch

**Files:**
- Modify: `README.md` (table row for `office/` + a short «Офис агентов» section: how to start on Windows and macOS/Linux, what it reads, limits)
- Modify: `setup-windows.ps1` (final message: how to open the office)

- [ ] **Step 1:** Write the README section and the setup message.
- [ ] **Step 2: Run** `node --test tests/office/` and `scripts/verify.sh` style check — Expected: pass.
- [ ] **Step 3: Commit and push** `git commit -m "Document the agent office" && git push`
