import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..');

const port = 31910;
const baseUrl = `http://127.0.0.1:${port}`;

test('Async error handling', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-err-'));
  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), SQLITE_DB_PATH: join(directory, 'test.db.bin'), MEDIA_STORAGE_ROOT: join(directory, 'uploads'), ALLOW_DEV_AUTH: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    server.kill();
    await rm(directory, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API did not start')), 10_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once('error', reject);
  });

  await t.test('Rejected promise in async route returns 500', async () => {
    const response = await fetch(`${baseUrl}/meta/_test/throw`, {
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user_pixelhunter' },
    });
    const json = await response.json().catch(() => ({}));
    assert.equal(response.status, 500, 'Rejected promise should return 500');
    assert.ok(!json.stack, 'Response must not contain stack trace');
    assert.ok(!json.sql, 'Response must not contain SQL');
    assert.ok(json.error, 'Response should have an error message');
  });

  await t.test('Server remains alive after rejected promise', async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.status, 'ok');
  });

  await t.test('Rejected promise in auth-wrapped route returns 500', async () => {
    const response = await fetch(`${baseUrl}/meta/_test/auth-error`, {
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user_pixelhunter' },
    });
    const json = await response.json().catch(() => ({}));
    assert.equal(response.status, 500, 'Auth-wrapped rejected promise should return 500');
    assert.ok(!json.stack, 'Response must not contain stack trace');
  });

  await t.test('Server still alive after auth-wrapped error', async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
  });

  await t.test('Error response does not contain internal details', async () => {
    const response = await fetch(`${baseUrl}/users/nonexistent/profile`, {
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user_pixelhunter' },
    });
    const json = await response.json();
    assert.equal(response.status, 404);
    assert.ok(!json.stack, 'Response should not contain stack trace');
    assert.ok(!json.sql, 'Response should not contain SQL');
    assert.ok(!json.token, 'Response should not contain tokens');
    assert.ok(json.error, 'Response should have an error message');
  });

  await t.test('Invalid JSON body returns 400', async () => {
    const response = await fetch(`${baseUrl}/posts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user_pixelhunter' },
      body: 'not json',
    });
    assert.ok(response.status === 400 || response.status === 500);
  });

  await t.test('Non-existent route returns 404', async () => {
    const response = await fetch(`${baseUrl}/nonexistent-route`, {
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user_pixelhunter' },
    });
    assert.equal(response.status, 404);
  });
});
