import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const serverDir = process.cwd().toLowerCase().endsWith('server') ? process.cwd() : join(process.cwd(), 'server');
const port = 32700 + (process.pid % 200);
const baseUrl = `http://127.0.0.1:${port}`;
const validPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function request(path, { method = 'GET', body, userId = 'abuse-user' } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = response.headers.get('content-type')?.includes('application/json')
    ? await response.json().catch(() => ({}))
    : {};
  return { response, json };
}

function createBody(title) {
  return {
    title,
    width: 8,
    height: 8,
    palette: ['#102030', '#00b5d8'],
    cells: Array(64).fill(0),
    originalDataUrl: validPng,
  };
}

async function waitForServer(child) {
  await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`upload abuse server did not start${stderr ? `: ${stderr}` : ''}`)), 15_000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code, signal) => reject(new Error(`upload abuse server exited (code=${code}, signal=${signal})`)));
  });
}

test('create budget and content-addressed originals bound upload amplification', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-upload-abuse-'));
  const child = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL: '',
      NODE_ENV: 'test',
      PORT: String(port),
      SQLITE_DB_PATH: join(directory, 'test.db.bin'),
      MEDIA_STORAGE_ROOT: join(directory, 'uploads'),
      ALLOW_DEV_AUTH: 'true',
      RATE_LIMIT_MAX: '10000',
      CREATE_UPLOAD_LIMIT: '2',
      CREATE_UPLOAD_WINDOW_MS: '600000',
      RENDER_OUTBOX_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await rm(directory, { recursive: true, force: true });
  });
  await waitForServer(child);

  const oversized = await request('/colorings/create', {
    method: 'POST',
    body: { ...createBody('Oversized source'), originalDataUrl: `data:image/png;base64,${'A'.repeat(14_000_001)}` },
  });
  assert.equal(oversized.response.status, 413);
  assert.equal(oversized.json.code, 'SOURCE_IMAGE_TOO_LARGE');

  const first = await request('/colorings/create', { method: 'POST', body: createBody('First upload') });
  const second = await request('/colorings/create', { method: 'POST', body: createBody('Duplicate upload') });
  assert.equal(first.response.status, 201);
  assert.equal(second.response.status, 201);

  const originalDir = join(directory, 'uploads', 'originals', 'abuse-user');
  assert.equal((await readdir(originalDir)).length, 1, 'duplicate source bytes must occupy one private object');

  const limited = await request('/colorings/create', { method: 'POST', body: createBody('Conversion spam') });
  assert.equal(limited.response.status, 429);
  assert.equal(limited.json.code, 'ABUSE_LIMITED');
  assert.ok(Number(limited.response.headers.get('retry-after')) >= 1);

  const deletedFirst = await request(`/colorings/${first.json.id}`, { method: 'DELETE' });
  assert.equal(deletedFirst.response.status, 200);
  assert.equal((await readdir(originalDir)).length, 1, 'shared source must survive while another template references it');
  const deletedSecond = await request(`/colorings/${second.json.id}`, { method: 'DELETE' });
  assert.equal(deletedSecond.response.status, 200);
  assert.equal((await readdir(originalDir)).length, 0, 'last reference removal must clean the source object');
});
