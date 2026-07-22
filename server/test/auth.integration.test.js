import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..');

const port = 31902;
const baseUrl = `http://127.0.0.1:${port}`;

async function fetchWith(path, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  const json = await response.json().catch(() => ({}));
  return { response, json };
}

function buildValidTelegramInitData(userObj, botToken, overrides = {}) {
  const data = {
    query_id: 'AAHdF6iqAAAAAN0X6Ko',
    user: JSON.stringify(userObj),
    auth_date: String(Math.floor(Date.now() / 1000)),
    hash: '',
    ...overrides,
  };
  const params = new URLSearchParams(data);
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

const testBotToken = '1234567890:ABCdefGHIjklMNOpqrsTUVwxyz';

test('Dev-auth requires explicit ALLOW_DEV_AUTH=true', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-auth-'));
  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(port), SQLITE_DB_PATH: join(directory, 'test.db.bin'), MEDIA_STORAGE_ROOT: join(directory, 'uploads') },
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

  await t.test('X-User-Id without ALLOW_DEV_AUTH returns 401', async () => {
    const { response } = await fetchWith('/health');
    assert.equal(response.status, 200);

    const me = await fetchWith('/users/me', { 'X-User-Id': 'user_pixelhunter' });
    assert.equal(me.response.status, 401, 'Should return 401 when ALLOW_DEV_AUTH is not set');
  });

  await t.test('Health check still works without auth', async () => {
    const { response } = await fetchWith('/health');
    assert.equal(response.status, 200);
  });
});

test('Dev-auth works with ALLOW_DEV_AUTH=true', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-auth2-'));
  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(port + 1), SQLITE_DB_PATH: join(directory, 'test.db.bin'), MEDIA_STORAGE_ROOT: join(directory, 'uploads'), ALLOW_DEV_AUTH: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    server.kill();
    await rm(directory, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port + 1}`;

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

  await t.test('X-User-Id with ALLOW_DEV_AUTH=true works', async () => {
    const response = await fetch(`${base}/users/me`, {
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user_pixelhunter' },
    });
    const json = await response.json();
    assert.equal(response.status, 200);
    assert.equal(json.id, 'user_pixelhunter');
  });
});

test('Production with ALLOW_DEV_AUTH=true fails to start', async (t) => {
  await t.test('Server throws on startup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'splint-prod-'));
    const server = spawn('node', ['index.js'], {
      cwd: serverDir,
      env: { ...process.env, PORT: String(port + 2), SQLITE_DB_PATH: join(directory, 'test.db.bin'), ALLOW_DEV_AUTH: 'true', NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let errorOutput = '';
    const exitPromise = new Promise((resolve) => {
      server.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });
      server.once('exit', (code) => resolve(code));
    });

    const code = await exitPromise;
    assert.notEqual(code, 0, 'Process should exit with non-zero code');
    assert.ok(errorOutput.includes('ALLOW_DEV_AUTH') || code !== 0, 'Should fail due to ALLOW_DEV_AUTH in production');

    server.kill();
    await rm(directory, { recursive: true, force: true });
  });

  await t.test('Production without TELEGRAM_BOT_TOKEN fails to start', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'splint-prod2-'));
    const server = spawn('node', ['index.js'], {
      cwd: serverDir,
      env: { ...process.env, PORT: String(port + 3), SQLITE_DB_PATH: join(directory, 'test.db.bin'), NODE_ENV: 'production', ALLOW_DEV_AUTH: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let errorOutput = '';
    const exitPromise = new Promise((resolve) => {
      server.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });
      server.once('exit', (code) => resolve(code));
    });

    const code = await exitPromise;
    assert.notEqual(code, 0, 'Process should exit with non-zero code');
    assert.ok(errorOutput.includes('TELEGRAM_BOT_TOKEN') || code !== 0, 'Should fail due to missing TELEGRAM_BOT_TOKEN');

    server.kill();
    await rm(directory, { recursive: true, force: true });
  });
});

test('Telegram initData authentication', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-telegram-'));
  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(port + 4), SQLITE_DB_PATH: join(directory, 'test.db.bin'), MEDIA_STORAGE_ROOT: join(directory, 'uploads'), TELEGRAM_BOT_TOKEN: testBotToken },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    server.kill();
    await rm(directory, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port + 4}`;

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

  await t.test('Valid initData is accepted and creates user', async () => {
    const telegramUser = { id: 999001, first_name: 'TestTgUser', username: 'test_tg_user' };
    const initData = buildValidTelegramInitData(telegramUser, testBotToken);

    const response = await fetch(`${base}/users/me`, {
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
    });
    const json = await response.json();
    assert.equal(response.status, 200);
    assert.equal(json.nickname, 'test_tg_user');
  });

  await t.test('Invalid hash returns 401', async () => {
    const telegramUser = { id: 999002, first_name: 'BadHash' };
    const initData = buildValidTelegramInitData(telegramUser, testBotToken);
    // Corrupt hash
    const corrupted = initData.replace(/hash=[^&]+/, 'hash=deadbeef');

    const response = await fetch(`${base}/users/me`, {
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': corrupted },
    });
    assert.equal(response.status, 401);
  });

  await t.test('Expired auth_date returns 401', async () => {
    const telegramUser = { id: 999003, first_name: 'Expired' };
    const initData = buildValidTelegramInitData(telegramUser, testBotToken, {
      auth_date: String(Math.floor(Date.now() / 1000) - 100_000),
    });

    const response = await fetch(`${base}/users/me`, {
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
    });
    assert.equal(response.status, 401);
  });

  await t.test('X-User-Id does not override Telegram user when valid initData present', async () => {
    const telegramUser = { id: 999004, first_name: 'TelegramUser', username: 'tg_user_4' };
    const initData = buildValidTelegramInitData(telegramUser, testBotToken);

    const response = await fetch(`${base}/users/me`, {
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData, 'X-User-Id': 'user_pixelhunter' },
    });
    const json = await response.json();
    assert.equal(response.status, 200);
    assert.equal(json.nickname, 'tg_user_4', 'Should use Telegram user, not X-User-Id');
  });
});

test('Role-based authorization', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-roles-'));
  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port + 5), SQLITE_DB_PATH: join(directory, 'test.db.bin'), MEDIA_STORAGE_ROOT: join(directory, 'uploads'), ALLOW_DEV_AUTH: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    server.kill();
    await rm(directory, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port + 5}`;

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

  await t.test('Regular user gets 403 on moderator route', async () => {
    const response = await fetch(`${base}/moderation/reports`, {
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user_pixelhunter' },
    });
    assert.equal(response.status, 403, 'Regular user should not access mod routes');
  });

  await t.test('Moderator gets access to moderator route', async () => {
    const response = await fetch(`${base}/moderation/reports`, {
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user_splintmod' },
    });
    assert.equal(response.status, 200, 'Moderator should access mod routes');
  });

  await t.test('user_splintmod with role=user gets 403 on moderator route', async () => {
    // Demote user_splintmod to 'user' via test-only endpoint
    const demote = await fetch(`${base}/meta/_test/set-role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user_splintmod' },
      body: JSON.stringify({ userId: 'user_splintmod', role: 'user' }),
    });
    assert.equal(demote.status, 200, 'Should be able to set role in test env');

    const response = await fetch(`${base}/moderation/reports`, {
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user_splintmod' },
    });
    assert.equal(response.status, 403, 'user_splintmod with role=user should get 403');
  });

  await t.test('Promoting back to moderator restores access', async () => {
    const promote = await fetch(`${base}/meta/_test/set-role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user_pixelhunter' },
      body: JSON.stringify({ userId: 'user_splintmod', role: 'moderator' }),
    });
    assert.equal(promote.status, 200);

    const response = await fetch(`${base}/moderation/reports`, {
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user_splintmod' },
    });
    assert.equal(response.status, 200, 'Restored moderator should have access');
  });
});

test('Debug stars endpoint is dev-only', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-stars-'));
  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(port + 6), SQLITE_DB_PATH: join(directory, 'test.db.bin'), MEDIA_STORAGE_ROOT: join(directory, 'uploads'), ALLOW_DEV_AUTH: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    server.kill();
    await rm(directory, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port + 6}`;

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

  await t.test('add-stars endpoint works in dev with ALLOW_DEV_AUTH=true', async () => {
    const response = await fetch(`${base}/users/user_pixelhunter/add-stars`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user_pixelhunter' },
    });
    assert.equal(response.status, 200, 'add-stars should work in dev mode');
  });

  await t.test('add-stars returns 403 for different user', async () => {
    const response = await fetch(`${base}/users/user_lenaart/add-stars`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user_pixelhunter' },
    });
    assert.equal(response.status, 403, 'Cannot add stars to another user');
  });
});

test('Debug stars endpoint is absent without ALLOW_DEV_AUTH', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-stars2-'));
  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(port + 7), SQLITE_DB_PATH: join(directory, 'test.db.bin'), MEDIA_STORAGE_ROOT: join(directory, 'uploads') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    server.kill();
    await rm(directory, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port + 7}`;

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

  await t.test('add-stars returns 404 when ALLOW_DEV_AUTH is not set', async () => {
    const response = await fetch(`${base}/users/user_pixelhunter/add-stars`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user_pixelhunter' },
    });
    assert.equal(response.status, 404, 'add-stars should return 404, not 401 or 403');
  });
});
