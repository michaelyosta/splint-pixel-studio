import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..');
const port = 31909;
const baseUrl = `http://127.0.0.1:${port}`;

async function stopServer(server) {
  if (server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
}

async function request(path, { userId, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  return { response, json };
}

test('analytics allowlist accepts special help onboarding events', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-analytics-allowlist-'));
  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      SQLITE_DB_PATH: join(directory, 'test.db.bin'),
      MEDIA_STORAGE_ROOT: join(directory, 'uploads'),
      ALLOW_DEV_AUTH: 'true',
      SEED_DEMO_DATA: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    await stopServer(server);
    await rm(directory, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API did not start')), 8_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once('error', reject);
  });

  const userId = 'user_analytics_allowlist';
  const hint = await request('/meta/analytics', {
    userId,
    method: 'POST',
    body: { event: 'special_help_hint_shown', payload: { kind: 'spark', id: 'catalog_fox' } },
  });
  assert.equal(hint.response.status, 200);
  assert.equal(hint.json.success, true);

  const opened = await request('/meta/analytics', {
    userId,
    method: 'POST',
    body: { event: 'special_help_opened', payload: { source: 'hint', id: 'catalog_fox' } },
  });
  assert.equal(opened.response.status, 200);
  assert.equal(opened.json.success, true);

  const summary = await request('/meta/analytics/summary', { userId });
  assert.equal(summary.response.status, 200);
  assert.equal(summary.json.special_help_hint_shown, 1);
  assert.equal(summary.json.special_help_opened, 1);

  const unknown = await request('/meta/analytics', {
    userId,
    method: 'POST',
    body: { event: 'special_help_nonsense', payload: {} },
  });
  assert.equal(unknown.response.status, 400);
});
