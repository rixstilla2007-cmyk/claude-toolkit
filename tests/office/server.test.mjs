import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startServer } from '../../office/server.mjs';
import { makeFixture, serverSuite } from './server-suite.mjs';

test('node server', async t => {
  const { root, dir } = makeFixture();
  const server = await startServer({ root, dir, port: 47100 });
  try {
    await serverSuite(t, `http://127.0.0.1:${server.port}`);
  } finally {
    await server.close();
  }
});

test('busy port moves to next', async () => {
  const { root, dir } = makeFixture();
  const blocker = net.createServer();
  await new Promise(r => blocker.listen(47200, '127.0.0.1', r));
  const server = await startServer({ root, dir, port: 47200 });
  try {
    assert.equal(server.port, 47201);
  } finally {
    await server.close();
    blocker.close();
  }
});
