import { test } from 'node:test';
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
  } finally {
    child.kill();
  }
});
