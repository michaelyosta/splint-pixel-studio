import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.platform === 'win32') {
  console.log(JSON.stringify({ skipped: true, reason: 'POSIX signal validation requires a POSIX runtime' }));
  process.exit(0);
}

const port = Number(process.env.OPERATIONS_TEST_PORT || 31911);
const directory = await mkdtemp(join(tmpdir(), 'splint-shutdown-'));
const server = spawn(process.execPath, ['index.js'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    SQLITE_DB_PATH: join(directory, 'test.db.bin'),
    MEDIA_STORAGE_ROOT: join(directory, 'uploads'),
    ALLOW_DEV_AUTH: 'true',
    SHUTDOWN_TIMEOUT_MS: '5000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
server.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
server.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API did not start')), 10_000);
    const onData = (chunk) => {
      if (!chunk.toString().includes('running on')) return;
      clearTimeout(timer);
      resolve();
    };
    server.stdout.on('data', onData);
    server.once('error', reject);
    server.once('exit', (code, signal) => reject(new Error(`API exited before startup: ${code ?? signal}`)));
  });

  const live = await fetch(`http://127.0.0.1:${port}/live`);
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), { status: 'alive' });

  const ready = await fetch(`http://127.0.0.1:${port}/ready`);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).ready, true);

  server.kill('SIGTERM');
  const exit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('graceful shutdown timeout')), 10_000);
    server.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });

  assert.deepEqual(exit, { code: 0, signal: null });
  assert.match(stdout, /"type":"shutdown"/);
  assert.match(stdout, /"signal":"SIGTERM"/);
  assert.match(stdout, /"forced":false/);
  assert.equal(stderr.trim(), '');
  console.log(JSON.stringify({ passed: true, live_status: live.status, ready_status: ready.status, exit, shutdown_logged: true }));
} finally {
  if (!server.killed && server.exitCode === null) server.kill('SIGKILL');
  await rm(directory, { recursive: true, force: true });
}
