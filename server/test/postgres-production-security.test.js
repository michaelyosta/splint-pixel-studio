import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.DATABASE_URL;
const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');

async function getFreePort() {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function spawnProductionServer(schema, rateLimitMax) {
  const port = await getFreePort();
  let stderr = '';
  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ALLOW_DEV_AUTH: 'false',
      SEED_DEMO_DATA: 'false',
      DATABASE_URL: databaseUrl,
      PGOPTIONS: `-c search_path="${schema}",public`,
      PORT: String(port),
      TELEGRAM_BOT_TOKEN: 'production-test-token',
      STORAGE_DRIVER: 's3',
      S3_ENDPOINT: 'https://s3.example.com',
      S3_BUCKET: 'splint-test',
      S3_ACCESS_KEY_ID: 'test-access',
      S3_SECRET_ACCESS_KEY: 'test-secret',
      CORS_ORIGINS: 'https://allowed.example',
      TRUST_PROXY: '10.0.0.0/8',
      RATE_LIMIT_MAX: String(rateLimitMax),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Production API did not start: ${stderr}`)), 15_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once('exit', (code) => reject(new Error(`Production API exited ${code}: ${stderr}`)));
  });
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    server.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    if (!server.killed) server.kill();
  });
}

test('full production configuration starts with strict CORS, CSP and proxy-safe rate limiting', { skip: !databaseUrl }, async (t) => {
  const pg = (await import('pg')).default;
  const schema = `production_security_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const adminPool = new pg.Pool({ connectionString: databaseUrl });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const servers = [];
  t.after(async () => {
    for (const server of servers) await stopServer(server);
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminPool.end();
  });

  const normal = await spawnProductionServer(schema, 100);
  servers.push(normal.server);

  const allowed = await fetch(`${normal.baseUrl}/health`, {
    headers: { Origin: 'https://allowed.example' },
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://allowed.example');
  assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
  const csp = allowed.headers.get('content-security-policy') || '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /img-src 'self' data:/);

  const denied = await fetch(`${normal.baseUrl}/health`, {
    headers: { Origin: 'https://evil.example' },
  });
  assert.equal(denied.status, 200);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  assert.equal(denied.headers.get('access-control-allow-credentials'), null);

  await stopServer(normal.server);

  const limited = await spawnProductionServer(schema, 1);
  servers.push(limited.server);
  const first = await fetch(`${limited.baseUrl}/health`, {
    headers: { 'X-Forwarded-For': '198.51.100.1' },
  });
  assert.equal(first.status, 200);

  const oversized = `{"payload":"${'x'.repeat(16 * 1024 * 1024)}"}`;
  const second = await fetch(`${limited.baseUrl}/unmatched`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '203.0.113.2',
    },
    body: oversized,
  });
  assert.equal(second.status, 429, 'untrusted X-Forwarded-For must not bypass the limiter');
  assert.deepStrictEqual(await second.json(), { error: 'Слишком много запросов, попробуйте через минуту' });
  await stopServer(limited.server);
});
