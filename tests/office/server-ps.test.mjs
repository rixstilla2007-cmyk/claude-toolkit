import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeFixture, serverSuite } from './server-suite.mjs';

const script = fileURLToPath(new URL('../../office/server.ps1', import.meta.url));
const pwsh = ['pwsh', 'powershell'].find(cmd => spawnSync(cmd, ['-NoProfile', '-Command', 'exit 0']).status === 0);

test('powershell server', { skip: !pwsh && 'pwsh is not on PATH' }, async t => {
  const { root, dir } = makeFixture();
  const child = spawn(pwsh, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Port', '47300', '-Root', root, '-Dir', dir, '-NoBrowser']);
  try {
    const port = await new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error('no start line: ' + out)), 20000);
      const take = d => {
        out += d;
        const m = /Офис: http:\/\/localhost:(\d+)\//.exec(out);
        if (m) { clearTimeout(timer); resolve(Number(m[1])); }
      };
      child.stdout.setEncoding('utf8').on('data', take);
      child.stderr.setEncoding('utf8').on('data', take);
      child.on('exit', code => reject(new Error(`exited ${code}: ${out}`)));
    });
    await serverSuite(t, `http://127.0.0.1:${port}`);
    // On Windows http.sys may accept a LAN connection that claims Host: localhost. A request whose
    // source address differs from the listener's (127.0.0.2 here) stands in for that machine.
    await t.test('request from another address is refused', async () => {
      const r = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: '/api/sessions', localAddress: '127.0.0.2', headers: { Host: `localhost:${port}` } }, res => {
        let body = ''; res.setEncoding('utf8').on('data', d => body += d).on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', reject));
      assert.equal(r.status, 403, r.body.slice(0, 80));
      assert.doesNotMatch(r.body, /proj-a/);
    });
  } finally {
    child.kill();
  }
});
