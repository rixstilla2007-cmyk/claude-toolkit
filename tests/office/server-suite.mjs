// HTTP checks shared by the Node server test and the PowerShell server test.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MB = 1024 * 1024;

// A projects root under a folder with Cyrillic letters and a space, like C:\Users\Рикс.
export function makeFixture() {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'office-'));
  const root = path.join(top, 'Рикс dir', 'projects');
  const dir = path.join(top, 'static');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<title>Офис Claude</title>');
  fs.writeFileSync(path.join(dir, 'feed.js'), 'function createFeed() {}');
  const put = (rel, text, ageSec) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
    const t = new Date(Date.now() - ageSec * 1000);
    fs.utimesSync(full, t, t);
  };
  for (let i = 0; i < 22; i++) put(`proj-b/old-${i}.jsonl`, '{"n":' + i + '}\n', 100 + i);
  put('proj-c/partial.jsonl', '{"a":1}\n{"partial', 500);
  const line = JSON.stringify({ pad: 'я'.repeat(500) }) + '\n';
  put('proj-c/big.jsonl', line.repeat(Math.ceil(5 * MB / Buffer.byteLength(line))), 600);
  put('proj-a/s1/subagents/agent-a1.jsonl', '{"type":"user"}\n', 1);
  put('proj-a/s1.jsonl', '{"type":"user"}\n', 0);
  return { root, dir };
}

export function get(base, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(base + pathname, { headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}
const json = async (base, p) => { const r = await get(base, p); assert.equal(r.status, 200, r.body); return JSON.parse(r.body); };
const read = (base, file, from) => json(base, `/api/read?file=${encodeURIComponent(file)}&from=${from}`);

export async function serverSuite(t, base) {
  await t.test('sessions newest first, max 20, lists subs', async () => {
    const list = await json(base, '/api/sessions');
    assert.equal(list.length, 20);
    assert.equal(list[0].file, 'proj-a/s1.jsonl');
    assert.equal(list[0].project, 'proj-a');
    assert.deepEqual(list[0].subs.map(s => s.file), ['proj-a/s1/subagents/agent-a1.jsonl']);
    assert.ok(list[0].subs[0].mtime > 0, 'sub mtime');
    for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].mtime >= list[i].mtime);
  });

  await t.test('read cuts at last newline', async () => {
    const a = await read(base, 'proj-c/partial.jsonl', 0);
    assert.equal(a.text, '{"a":1}\n');
    assert.equal(a.next, 8);
    const b = await read(base, 'proj-c/partial.jsonl', a.next);
    assert.equal(b.text, '');
    assert.equal(b.next, 8);
  });

  await t.test('read caps at 4 MB', async () => {
    const a = await read(base, 'proj-c/big.jsonl', 0);
    assert.ok(a.next <= 4 * MB && a.next > 3 * MB, String(a.next));
    assert.ok(a.text.endsWith('\n'));
    assert.equal(Buffer.byteLength(a.text), a.next);
    const b = await read(base, 'proj-c/big.jsonl', a.next);
    assert.ok(b.text.length > 0 && b.next > a.next);
    const rest = await read(base, 'proj-c/big.jsonl', b.next);
    assert.equal(rest.text, '');
  });

  await t.test('bad paths are 400', async () => {
    for (const f of ['../x.jsonl', '/etc/passwd', 'proj-a/s1.txt', 'proj-a/../../x.jsonl', 'C:\\Windows\\x.jsonl', '..\\x.jsonl']) {
      const r = await get(base, `/api/read?file=${encodeURIComponent(f)}&from=0`);
      assert.equal(r.status, 400, f);
    }
    const missing = await get(base, `/api/read?file=${encodeURIComponent('proj-a/nope.jsonl')}&from=0`);
    assert.equal(missing.status, 404);
  });

  await t.test('wrong Host is refused', async () => {
    const port = new URL(base).port;
    const r = await get(base, '/api/sessions', { Host: `evil.example:${port}` });
    // Node answers 403 itself; HttpListener refuses a host it does not serve before our code runs (400/404).
    assert.ok([400, 403, 404].includes(r.status), String(r.status));
    assert.doesNotMatch(r.body, /proj-a/);
  });

  await t.test('serves index and feed.js', async () => {
    const page = await get(base, '/');
    assert.equal(page.status, 200);
    assert.match(page.type, /text\/html/);
    assert.match(page.body, /Офис Claude/);
    const feed = await get(base, '/feed.js');
    assert.equal(feed.status, 200);
    assert.match(feed.type, /javascript/);
    assert.equal((await get(base, '/secret.txt')).status, 404);
  });
}
