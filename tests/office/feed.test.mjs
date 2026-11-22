import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { createFeed, parseLines, roomFor, pickSession } = createRequire(import.meta.url)('../../office/feed.js');

// Entries shaped like real Claude Code transcript lines.
const ts = s => `2026-11-22T10:00:${String(s).padStart(2, '0')}.000Z`;
const user = (content, s, extra = {}) => ({ type: 'user', timestamp: ts(s), message: { role: 'user', content }, ...extra });
const call = (id, name, input, s) => ({ type: 'assistant', timestamp: ts(s), message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, s, toolUseResult = { status: 'completed' }) => ({ type: 'user', timestamp: ts(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] }, toolUseResult });
const endTurn = s => ({ type: 'assistant', timestamp: ts(s), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Готово.' }] } });
const SUB = '-proj/sess/subagents/agent-a1.jsonl';
const askResearcher = (feed, id = 'c1', prompt = 'Найди тренды Reels', s = 2) =>
  feed.addMain(call(id, 'Agent', { subagent_type: 'researcher', description: 'Тренды Reels', prompt }, s));
const worker = (feed, name) => feed.snapshot().workers.find(w => w.name === name);

test('user prompt starts a task', () => {
  const feed = createFeed();
  feed.addMain(user('Составь план монетизации Instagram\nПодробно, с цифрами', 1));
  const { task, workers } = feed.snapshot();
  assert.equal(task.title, 'Составь план монетизации Instagram');
  assert.equal(task.done, false);
  assert.equal(workers[0].key, 'me');
  assert.equal(workers[0].status, 'Читаю задачу');
});

test('task title is cut to 60 characters', () => {
  const feed = createFeed();
  feed.addMain(user('а'.repeat(80), 1));
  assert.equal(feed.snapshot().task.title.length, 60);
});

test('Agent call creates a researcher in the library', () => {
  const feed = createFeed();
  feed.addMain(user('Задача', 1));
  askResearcher(feed);
  const { workers } = feed.snapshot();
  assert.equal(workers[1].type, 'researcher');
  assert.equal(workers[1].room, 'library');
  assert.equal(workers[1].kind, 'work');
  assert.ok(workers[0].status.startsWith('Поручаю researcher'), workers[0].status);
});

test('sub file is linked by prompt and shows its steps', () => {
  const feed = createFeed();
  askResearcher(feed);
  feed.addSub(SUB, user('Найди тренды Reels', 3, { isSidechain: true, agentId: 'a1' }));
  feed.addSub(SUB, call('s1', 'Read', { file_path: 'C:\\Users\\Рикс\\proj\\README.md' }, 4));
  const w = worker(feed, 'researcher');
  assert.equal(w.status, 'Читает README.md');
  assert.equal(w.log.length, 2); // assigned + Read
});

test('sub lines that arrive before the Agent call are kept until it comes', () => {
  const feed = createFeed();
  feed.addSub(SUB, user('Найди тренды Reels', 3));
  feed.addSub(SUB, call('s1', 'Grep', { pattern: 'reels' }, 4));
  askResearcher(feed, 'c1', 'Найди тренды Reels', 5);
  assert.equal(worker(feed, 'researcher').status, 'Ищет: reels');
});

test('mcp call shows the service', () => {
  const feed = createFeed();
  askResearcher(feed);
  feed.addSub(SUB, user('Найди тренды Reels', 3));
  feed.addSub(SUB, call('s1', 'mcp__plugin_small-business_gmail__search_threads', {}, 4));
  const w = worker(feed, 'researcher');
  assert.equal(w.kind, 'mcp');
  assert.equal(w.mcp, 'gmail');
});

test('Agent result finishes the worker', () => {
  const feed = createFeed();
  askResearcher(feed);
  feed.addMain(result('c1', 9, { status: 'completed', agentId: 'a1' }));
  const w = worker(feed, 'researcher');
  assert.equal(w.kind, 'done');
  assert.equal(w.status, 'Готово');
});

test('async agent done only at end_turn', () => {
  const feed = createFeed();
  askResearcher(feed);
  feed.addMain(result('c1', 3, { status: 'async_launched', agentId: 'a9' }));
  assert.equal(worker(feed, 'researcher').kind, 'work');
  const file = '-proj/sess/subagents/agent-a9.jsonl';
  feed.addSub(file, user('другой текст', 4));
  feed.addSub(file, call('s1', 'WebSearch', { query: 'reels 2026' }, 5));
  assert.equal(worker(feed, 'researcher').status, 'Ищет в интернете: reels 2026');
  feed.addSub(file, endTurn(6));
  assert.equal(worker(feed, 'researcher').kind, 'done');
});

test('second researcher is #2', () => {
  const feed = createFeed();
  askResearcher(feed, 'c1', 'Первое');
  askResearcher(feed, 'c2', 'Второе', 3);
  const names = feed.snapshot().workers.slice(1).map(w => w.name);
  assert.deepEqual(names, ['researcher', 'researcher #2']);
});

test('end_turn with nothing open makes me idle', () => {
  const feed = createFeed();
  feed.addMain(user('Задача', 1));
  feed.addMain(call('t1', 'Read', { file_path: 'a.txt' }, 2));
  feed.addMain(result('t1', 3, {}));
  feed.addMain(endTurn(4));
  const { task, workers } = feed.snapshot();
  assert.equal(workers[0].kind, 'idle');
  assert.equal(workers[0].status, 'Жду задачу');
  assert.equal(task.done, true);
});

test('end_turn with a tool still open keeps me working', () => {
  const feed = createFeed();
  feed.addMain(user('Задача', 1));
  feed.addMain(call('t1', 'Bash', { command: 'npm test', description: 'Запускаю тесты' }, 2));
  feed.addMain(endTurn(3));
  assert.equal(feed.snapshot().workers[0].status, 'Запускаю тесты');
});

test('Skill in main is a skill step', () => {
  const feed = createFeed();
  feed.addMain(call('k1', 'Skill', { skill: 'assemble-team' }, 1));
  const me = feed.snapshot().workers[0];
  assert.equal(me.kind, 'skill');
  assert.equal(me.status, 'Скилл assemble-team');
});

test('tool results and meta messages are not tasks', () => {
  const feed = createFeed();
  feed.addMain(result('x', 1, {}));
  feed.addMain(user('<command-name>/clear</command-name>', 2));
  feed.addMain(user('Caveat: служебное', 3, { isMeta: true }));
  feed.addMain(user('<task-notification>agent done</task-notification>', 4));
  assert.equal(feed.snapshot().task, null);
});

test('unknown type goes to the open space', () => {
  assert.equal(roomFor('claude-security:scan-researcher'), 'workshop');
  assert.equal(roomFor('Explore'), 'library');
  assert.equal(roomFor('critic'), 'meeting');
  assert.equal(roomFor('verifier'), 'review');
});

test('parseLines skips broken line', () => {
  assert.equal(parseLines('{"a":1}\n{"b":\n{"c":3}\n').length, 2);
});

// Review fixes: Claude Code's own service lines and background agents, shaped like real transcript lines.
test('compaction summary, interrupt and shell-mode lines are not tasks', () => {
  const feed = createFeed();
  feed.addMain(user('Задача', 1));
  feed.addMain(user('This session is being continued from a previous conversation…', 2, { isCompactSummary: true }));
  feed.addMain(user('<bash-input>ls</bash-input>', 3));
  feed.addMain(user('<bash-stdout>a.txt</bash-stdout><bash-stderr></bash-stderr>', 4));
  feed.addMain(user([{ type: 'text', text: '[Request interrupted by user]' }], 5));
  assert.equal(feed.snapshot().task.title, 'Задача');
});

test('interrupt stops me', () => {
  const feed = createFeed();
  feed.addMain(user('Задача', 1));
  feed.addMain(call('t1', 'Bash', { command: 'npm test', description: 'Запускаю тесты' }, 2));
  feed.addMain(user([{ type: 'text', text: '[Request interrupted by user for tool use]' }], 3));
  assert.equal(feed.snapshot().workers[0].status, 'Жду задачу');
});

test('background agent keeps the task open until it reports back', () => {
  const feed = createFeed();
  feed.addMain(user('Задача', 1));
  askResearcher(feed);
  feed.addMain(result('c1', 3, { status: 'async_launched', agentId: 'a1' }));
  feed.addMain(endTurn(4));
  assert.equal(feed.snapshot().task.done, false);
  assert.equal(feed.snapshot().workers[0].status, 'Жду агентов');
  feed.addMain(user('<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>c1</tool-use-id>\n<status>completed</status>\n</task-notification>', 5));
  assert.equal(worker(feed, 'researcher').status, 'Готово');
  feed.addMain(call('t2', 'Edit', { file_path: 'feed.js' }, 6));
  assert.equal(feed.snapshot().task.done, false);
  feed.addMain(result('t2', 7, {}));
  feed.addMain(endTurn(8));
  assert.equal(feed.snapshot().task.done, true);
  assert.equal(feed.snapshot().workers[0].status, 'Жду задачу');
});

test('a tool call after the task was done reopens it', () => {
  const feed = createFeed();
  feed.addMain(user('Задача', 1));
  feed.addMain(endTurn(2));
  assert.equal(feed.snapshot().task.done, true);
  feed.addMain(call('t1', 'Read', { file_path: 'a.txt' }, 3));
  assert.equal(feed.snapshot().task.done, false);
});

test('agent report delivered mid-turn as an attachment finishes the agent', () => {
  const feed = createFeed();
  askResearcher(feed);
  feed.addMain(result('c1', 3, { status: 'async_launched', agentId: 'a1' }));
  feed.addMain({ type: 'attachment', timestamp: ts(4), attachment: { type: 'queued_command', prompt: '<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>c1</tool-use-id>\n<status>completed</status>\n</task-notification>' } });
  assert.equal(worker(feed, 'researcher').status, 'Готово');
});

// Which session «Последняя» shows. Times are ms; subs carry their own mtime.
const sess = (file, mtime, subs = []) => ({ file, project: 'p', mtime, size: 1, subs: subs.map(m => ({ file: `${file}/subagents/agent-${m}.jsonl`, size: 1, mtime: m })) });

test('pickSession follows the session that wrote last', () => {
  assert.equal(pickSession([sess('a', 5), sess('b', 9)], { now: 10 }).file, 'b');
});

test('pickSession counts subagent files as activity', () => {
  assert.equal(pickSession([sess('b', 9), sess('a', 5, [12])], { now: 13 }).file, 'a');
});

test('pickSession stays on a working session while another one writes', () => {
  const list = [sess('b', 100), sess('a', 90)];
  assert.equal(pickSession(list, { file: 'a', busy: true, now: 101 }).file, 'a');
  assert.equal(pickSession(list, { file: 'a', busy: false, now: 101 }).file, 'b');
});

test('pickSession leaves a working session that has been quiet for 10 minutes', () => {
  assert.equal(pickSession([sess('b', 700000), sess('a', 1000)], { file: 'a', busy: true, now: 700000 }).file, 'b');
});

test('pickSession keeps the pinned session', () => {
  assert.equal(pickSession([sess('b', 9), sess('a', 5)], { pinned: 'a', now: 10 }).file, 'a');
});
