// Read-only local server for the agent office (macOS, Linux, tests).
// Windows twin: server.ps1. Both serve the same API to office/index.html.
//   node office/server.mjs
import http from 'node:http';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX = 4 * 1024 * 1024;
const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/feed.js': ['feed.js', 'text/javascript; charset=utf-8'] };

export function defaultRoot() {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
}

async function entries(dir) {
  try { return await fsp.readdir(dir, { withFileTypes: true }); } catch { return []; }
}
const sizeOf = async full => { try { return await fsp.stat(full); } catch { return null; } };

async function listSessions(root) {
  const mains = [];
  for (const p of await entries(root)) {
    if (!p.isDirectory()) continue;
    for (const f of await entries(path.join(root, p.name))) {
      if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
      const st = await sizeOf(path.join(root, p.name, f.name));
      if (st) mains.push({ file: `${p.name}/${f.name}`, project: p.name, mtime: st.mtimeMs, size: st.size });
    }
  }
  mains.sort((a, b) => b.mtime - a.mtime);
  const top = mains.slice(0, 20);
  for (const m of top) {
    const rel = m.file.slice(0, -'.jsonl'.length) + '/subagents';
    m.subs = [];
    for (const f of await entries(path.join(root, rel))) {
      if (!f.isFile() || !f.name.startsWith('agent-') || !f.name.endsWith('.jsonl')) continue;
      const st = await sizeOf(path.join(root, rel, f.name));
      if (st) m.subs.push({ file: `${rel}/${f.name}`, size: st.size, mtime: st.mtimeMs });
    }
  }
  return top;
}

// Only a relative *.jsonl path inside root; anything else is refused.
function safePath(root, file) {
  if (typeof file !== 'string' || !file.endsWith('.jsonl') || path.isAbsolute(file) || /^[a-zA-Z]:/.test(file)) return null;
  if (file.split(/[\\/]/).includes('..')) return null;
  const top = path.resolve(root), full = path.resolve(top, ...file.split(/[\\/]/));
  return full.startsWith(top + path.sep) ? full : null;
}

async function readFrom(full, from) {
  const fh = await fsp.open(full, 'r');
  try {
    const { size } = await fh.stat();
    from = Math.max(0, Math.min(Number(from) || 0, size));
    const len = Math.min(MAX, size - from), buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, from);
    const got = buf.subarray(0, bytesRead), nl = got.lastIndexOf(10);
    // A single line longer than 4 MB is skipped instead of blocking the reader forever.
    const keep = nl >= 0 ? nl + 1 : (bytesRead === MAX ? bytesRead : 0);
    return { text: got.subarray(0, keep).toString('utf8'), next: from + keep };
  } finally {
    await fh.close();
  }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

export async function startServer({ root = defaultRoot(), port = 4545, dir = HERE } = {}) {
  let bound = 0;
  const server = http.createServer(async (req, res) => {
    try {
      const hosts = [`127.0.0.1:${bound}`, `localhost:${bound}`];
      if (!hosts.includes(req.headers.host)) return send(res, 403, { error: 'host' });
      if (req.method !== 'GET') return send(res, 405, { error: 'method' });
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (STATIC[url.pathname]) {
        const [name, type] = STATIC[url.pathname];
        return send(res, 200, await fsp.readFile(path.join(dir, name)), type);
      }
      if (url.pathname === '/api/sessions') return send(res, 200, await listSessions(root));
      if (url.pathname === '/api/read') {
        const full = safePath(root, url.searchParams.get('file'));
        if (!full) return send(res, 400, { error: 'file' });
        if (!(await sizeOf(full))) return send(res, 404, { error: 'missing' });
        return send(res, 200, await readFrom(full, url.searchParams.get('from')));
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 500, { error: String(e && e.message || e) });
    }
  });
  for (let p = port; p <= port + 10; p++) {
    const ok = await new Promise(resolve => {
      server.once('error', () => resolve(false));
      server.listen(p, '127.0.0.1', () => resolve(true));
    });
    if (ok) { bound = p; break; }
  }
  if (!bound) throw new Error(`ports ${port}-${port + 10} are busy`);
  return { port: bound, close: () => new Promise(r => server.close(() => r())) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = defaultRoot();
  const { port } = await startServer({ root });
  console.log(`Офис: http://localhost:${port}/`);
  console.log(`Читаю журналы из ${root}. Остановить: Ctrl+C`);
}
