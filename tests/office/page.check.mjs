// Live check of office/index.html against a growing fake transcript.
//   node tests/office/page.check.mjs            (needs Playwright with Chromium)
//   THREE_DIR=<three@0.128.0 package dir> ...   serves Three.js locally when the CDN is unreachable
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startServer } from '../../office/server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const officeDir = fileURLToPath(new URL('../../office/', import.meta.url));
const shot = process.env.SHOT || path.join(os.tmpdir(), 'office-page.png');

const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'office-page-')), 'projects');
const main = path.join(root, '-home-me-work', 'sess1.jsonl');
const sub = path.join(root, '-home-me-work', 'sess1', 'subagents', 'agent-a1.jsonl');
fs.mkdirSync(path.dirname(sub), { recursive: true });
const ts = () => new Date().toISOString();
const add = (file, obj) => fs.appendFileSync(file, JSON.stringify({ timestamp: ts(), ...obj }) + '\n');
const call = (id, name, input) => ({ type: 'assistant', message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] } });

add(main, { type: 'user', message: { role: 'user', content: 'Составь план монетизации Instagram' } });

const server = await startServer({ root, dir: officeDir, port: 47400 });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
let reads = 0;
page.on('request', r => { if (r.url().includes('/api/read')) reads++; });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
if (process.env.THREE_DIR) {
  await page.route('https://cdn.jsdelivr.net/npm/three@0.128.0/**', r =>
    r.fulfill({ path: path.join(process.env.THREE_DIR, r.request().url().split('three@0.128.0/')[1]), contentType: 'application/javascript' }));
}
await page.route('https://fonts.**', r => r.abort());

const row = name => page.locator('#rows .row', { has: page.locator('b', { hasText: new RegExp('^' + name + '$') }) });
async function expectRow(name, text) {
  await row(name).filter({ hasText: text }).first().waitFor({ timeout: 15000 });
  console.log(`ok  ${name}: ${text}`);
}

let failed = false;
try {
  await page.goto(`http://localhost:${server.port}/`);
  await expectRow('Я \\(Claude\\)', 'Читаю задачу');
  await page.locator('#task', { hasText: 'Составь план монетизации Instagram' }).waitFor({ timeout: 5000 });

  add(main, call('c1', 'Agent', { subagent_type: 'researcher', description: 'Тренды Reels', prompt: 'Найди тренды Reels' }));
  await expectRow('researcher', 'Работает');

  add(sub, { type: 'user', isSidechain: true, agentId: 'a1', message: { role: 'user', content: 'Найди тренды Reels' } });
  add(sub, call('s1', 'Read', { file_path: 'README.md' }));
  await expectRow('researcher', 'Читает README.md');

  add(main, call('c2', 'Agent', { subagent_type: 'researcher', description: 'Второй поиск', prompt: 'Ещё' }));
  await expectRow('researcher #2', 'Работает');

  // Another session writes while this one works: «Последняя» stays here.
  const other = path.join(root, '-home-me-other', 'sess2.jsonl');
  fs.mkdirSync(path.dirname(other), { recursive: true });
  add(other, { type: 'user', message: { role: 'user', content: 'Другая задача' } });
  await page.waitForTimeout(2500);
  if (!(await page.locator('#task').textContent()).includes('Составь план')) throw new Error('auto mode left the working session');
  console.log('ok  auto mode stays on the working session');

  // Switching to the other session and back must not add a second copy of researcher #2.
  await page.selectOption('#session', '-home-me-other/sess2.jsonl');
  await page.locator('#task', { hasText: 'Другая задача' }).waitFor({ timeout: 5000 });
  await page.selectOption('#session', '-home-me-work/sess1.jsonl');
  await expectRow('researcher #2', 'Работает');
  const copies = await row('researcher #2').count();
  if (copies !== 1) throw new Error('researcher #2 rows after switching back: ' + copies);
  console.log('ok  no duplicate copy after switching back');

  add(sub, call('s2', 'mcp__vidIQ__vidiq_trending_videos', {}));
  await expectRow('researcher', 'Внешний сервис');

  add(main, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'ok' }] }, toolUseResult: { status: 'completed', agentId: 'a1' } });
  await expectRow('researcher', 'Готово');

  await row('researcher').first().click();
  await page.locator('#drLog li', { hasText: 'Читает README.md' }).waitFor({ timeout: 5000 });
  console.log('ok  agent card shows real steps');

  add(main, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c2', content: 'ok' }] }, toolUseResult: { status: 'completed' } });
  add(main, { type: 'assistant', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Готово' }] } });
  await expectRow('Я \\(Claude\\)', 'Жду задачу');

  await page.waitForTimeout(1500);
  const before = reads;
  await page.waitForTimeout(2500);
  if (reads !== before) throw new Error(`${reads - before} reads while nothing changed`);
  console.log('ok  no reads while nothing changed');
  await page.screenshot({ path: shot });
  console.log('screenshot:', shot);

  await page.goto(`http://localhost:${server.port}/?demo`);
  await page.locator('#mode', { hasText: 'Демо' }).waitFor({ timeout: 5000 });
  console.log('ok  demo mode');
} catch (e) {
  failed = true;
  console.log('FAIL', e.message.split('\n')[0]);
} finally {
  if (errors.length) { failed = true; console.log('page errors:', errors); }
  await browser.close();
  await server.close();
}
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
