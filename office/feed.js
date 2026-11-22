// Turns Claude Code transcript lines into "who is doing what" for the office page.
// Classic script: in the browser it sets window.OfficeFeed, in Node it is require()-able.
(function (root) {
  const ROOMS = {
    library: ['researcher', 'Explore', 'claude-code-guide', 'web-fetch'],
    meeting: ['critic', 'Plan'],
    review: ['reviewer', 'verifier'],
  };
  const AGENT_TOOLS = new Set(['Agent', 'Task']);
  const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

  function roomFor(type) {
    for (const room in ROOMS) if (ROOMS[room].includes(type)) return room;
    return 'workshop';
  }

  function parseLines(text) {
    const out = [];
    for (const line of String(text).split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try { out.push(JSON.parse(s)); } catch (e) { /* a broken or half-written line is skipped */ }
    }
    return out;
  }

  const base = p => String(p || '').split(/[\\/]/).pop();
  const cut = (s, n) => {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };

  function describeTool(name, input) {
    input = input || {};
    if (name.startsWith('mcp__')) {
      const parts = name.split('__'), svc = (parts[1] || '').replace(/^plugin_[^_]+_/, '');
      return {kind: 'mcp', status: svc + ': ' + parts.slice(2).join('__'), tool: name, mcp: svc};
    }
    if (name === 'Skill') return {kind: 'skill', status: 'Скилл ' + (input.skill || ''), tool: name, mcp: ''};
    let status = name;
    if (name === 'Read') status = 'Читает ' + base(input.file_path);
    else if (EDIT_TOOLS.has(name)) status = 'Правит ' + base(input.file_path || input.notebook_path);
    else if (name === 'Bash') status = cut(input.description || input.command, 40);
    else if (name === 'Grep' || name === 'Glob') status = 'Ищет: ' + cut(input.pattern, 40);
    else if (name === 'WebSearch') status = 'Ищет в интернете: ' + cut(input.query, 40);
    else if (name === 'WebFetch') { let host = ''; try { host = new URL(input.url).host; } catch (e) { /* no url */ } status = 'Читает сайт ' + host; }
    else if (name === 'TodoWrite' || /^Task[A-Z]/.test(name)) status = 'Обновляет план';
    return {kind: 'work', status, tool: name, mcp: ''};
  }

  const textOf = c => typeof c === 'string' ? c
    : Array.isArray(c) ? c.filter(b => b && b.type === 'text').map(b => b.text).join('\n') : '';
  const timeOf = e => Date.parse(e.timestamp) || 0;
  const blocks = e => (e.message && Array.isArray(e.message.content)) ? e.message.content : [];

  function isPrompt(e) {
    if (e.type !== 'user' || e.isMeta || e.isCompactSummary || e.isVisibleInTranscriptOnly || !e.message) return false;
    if (blocks(e).some(b => b && b.type === 'tool_result')) return false;
    const s = textOf(e.message.content).trim();
    // Claude Code's own lines: slash commands, background-task reports, ! shell mode, Esc.
    return !!s && !/^(<(command-|local-command|task-notification|bash-|user-memory-input)|\[Request interrupted)/.test(s);
  }

  function createFeed() {
    const make = (key, type, name, room) => ({key, type, name, room, kind: 'idle', status: 'Свободен', tool: '', mcp: '', since: 0, log: []});
    const me = make('me', 'main', 'Я (Claude)', 'office');
    me.status = 'Жду задачу';
    const workers = [me], byCall = new Map(), byFile = new Map(), byAgentId = new Map(), waiting = new Map(), open = new Set();
    let task = null;

    function set(w, d, t) {
      Object.assign(w, {kind: d.kind, status: d.status, tool: d.tool || '', mcp: d.mcp || '', since: t});
      w.log.push({t, text: d.status, tool: d.tool || ''});
    }
    function finish(w, t) { if (w.kind !== 'done') set(w, {kind: 'done', status: 'Готово'}, t); }
    // Main stopped: the task is done only when no agent is still working in the background.
    function rest(t) {
      if (workers.some(w => w !== me && w.kind !== 'done')) return set(me, {kind: 'idle', status: 'Жду агентов'}, t);
      set(me, {kind: 'idle', status: 'Жду задачу'}, t);
      if (task) task.done = true;
    }
    function applySub(w, e) {
      if (w.kind === 'done' || e.type !== 'assistant') return;
      const t = timeOf(e);
      for (const b of blocks(e)) if (b && b.type === 'tool_use') set(w, describeTool(b.name, b.input), t);
      if (e.message.stop_reason === 'end_turn') finish(w, t);
    }
    function link(file, w, entries) {
      waiting.delete(file); byFile.set(file, w); w.file = file;
      entries.forEach(e => applySub(w, e));
    }
    const firstPrompt = entries => {
      const u = entries.find(e => e.type === 'user' && !blocks(e).some(b => b && b.type === 'tool_result'));
      return u ? textOf(u.message.content).trim() : '';
    };
    function tryLink(file) {
      const entries = waiting.get(file);
      const id = (/agent-(.+)\.jsonl$/.exec(file) || [])[1];
      let w = id && byAgentId.get(id);
      if (!w) { const p = firstPrompt(entries); if (p) w = workers.find(x => x.prompt === p && !x.file); }
      if (w && !w.file) link(file, w, entries);
    }

    function addMain(e) {
      const t = timeOf(e);
      if (isPrompt(e)) {
        task = {title: cut(textOf(e.message.content).trim().split('\n')[0], 60), at: t, done: false};
        open.clear();
        set(me, {kind: 'work', status: 'Читаю задачу'}, t);
        return;
      }
      if (e.type === 'assistant') {
        for (const b of blocks(e)) {
          if (!b || b.type !== 'tool_use') continue;
          open.add(b.id);
          if (task) task.done = false;
          const input = b.input || {};
          if (AGENT_TOOLS.has(b.name)) {
            const type = input.subagent_type || 'general-purpose';
            const busy = workers.filter(w => w.type === type && w.kind !== 'done').length;
            const w = make(b.id, type, busy ? type + ' #' + (busy + 1) : type, roomFor(type));
            w.prompt = String(input.prompt || '').trim();
            workers.push(w); byCall.set(b.id, w);
            set(w, {kind: 'work', status: cut(input.description || 'Получил задачу', 60)}, t);
            set(me, {kind: 'work', status: 'Поручаю ' + type + ': ' + cut(input.description, 40), tool: b.name}, t);
            for (const file of [...waiting.keys()]) tryLink(file);
          } else set(me, describeTool(b.name, input), t);
        }
        if (e.message && e.message.stop_reason === 'end_turn' && open.size === 0) rest(t);
        return;
      }
      // A background agent reports back with the id of the Agent call that started it:
      // as a user line when the main session is idle, as a queued_command attachment mid-turn.
      const queued = e.attachment && e.attachment.type === 'queued_command' ? String(e.attachment.prompt || '') : '';
      const text = (textOf(e.message && e.message.content) || queued).trim();
      const note = /^<task-notification>/.test(text) && /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(text);
      if (note && byCall.has(note[1])) finish(byCall.get(note[1]), t);
      for (const b of blocks(e)) {
        if (!b || b.type !== 'tool_result') continue;
        open.delete(b.tool_use_id);
        const w = byCall.get(b.tool_use_id), r = e.toolUseResult || {};
        if (!w) continue;
        if (r.agentId) { byAgentId.set(r.agentId, w); for (const file of [...waiting.keys()]) tryLink(file); }
        if (r.status !== 'async_launched') finish(w, t);
      }
      if (/^\[Request interrupted/.test(text)) { open.clear(); rest(t); }
    }

    function addSub(file, e) {
      const w = byFile.get(file);
      if (w) return applySub(w, e);
      if (!waiting.has(file)) waiting.set(file, []);
      waiting.get(file).push(e);
      tryLink(file);
    }

    function snapshot() {
      return {
        task: task && {...task},
        workers: workers.map(w => ({key: w.key, type: w.type, name: w.name, room: w.room, kind: w.kind, status: w.status, tool: w.tool, mcp: w.mcp, since: w.since, log: w.log})),
      };
    }
    return {addMain, addSub, snapshot};
  }

  // Which session «Последняя» shows: the pinned one; else the current one while it is still working
  // and wrote in the last 10 minutes; else the one that wrote last, counting its subagent files.
  const QUIET = 10 * 60 * 1000;
  const activity = s => Math.max(s.mtime, ...(s.subs || []).map(x => x.mtime || 0));
  function pickSession(list, {file = '', pinned = '', busy = false, now = Date.now()} = {}) {
    const pin = pinned && list.find(s => s.file === pinned);
    if (pin) return pin;
    const cur = list.find(s => s.file === file);
    if (cur && busy && now - activity(cur) < QUIET) return cur;
    return list.reduce((a, b) => activity(b) > activity(a) ? b : a, list[0]);
  }

  const api = {parseLines, describeTool, roomFor, createFeed, pickSession};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OfficeFeed = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
