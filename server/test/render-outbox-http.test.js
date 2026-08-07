import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..');
const port = 31921;
const baseUrl = `http://127.0.0.1:${port}`;

async function request(path, { userId = 'user_pixelhunter', method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['X-User-Id'] = userId;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = response.headers.get('content-type')?.includes('application/json')
    ? await response.json().catch(() => ({}))
    : {};
  return { response, json };
}

async function waitForServer(server) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Outbox HTTP server did not start')), 15_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once('error', reject);
  });
}

function serverEnv(overrides) {
  return {
    ...process.env,
    DATABASE_URL: '',
    PORT: String(port),
    ALLOW_DEV_AUTH: 'true',
    SEED_DEMO_DATA: 'true',
    RATE_LIMIT_MAX: '10000',
    ...overrides,
  };
}

async function readOutboxState(dbPath, artworkId) {
  const SQL = await initSqlJs();
  const db = new SQL.Database(await readFile(dbPath));
  try {
    const jobStmt = db.prepare('SELECT status,render_mode,attempt_count,last_error FROM render_outbox WHERE artwork_id=?');
    jobStmt.bind([artworkId]);
    const job = jobStmt.step() ? jobStmt.getAsObject() : null;
    jobStmt.free();
    const artStmt = db.prepare('SELECT render_status FROM artworks WHERE id=?');
    artStmt.bind([artworkId]);
    const artwork = artStmt.step() ? artStmt.getAsObject() : null;
    artStmt.free();
    return { job, artwork };
  } finally {
    db.close();
  }
}

async function waitForReady(templateId, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const progress = await request(`/colorings/${templateId}/progress`);
    if (progress.response.status === 200 && progress.json.render_status === 'ready') {
      return progress.json;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Artwork did not become ready within ${timeoutMs}ms`);
}

async function completionBody(clientBatchId, cellCount) {
  return {
    revision: 0,
    clientBatchId,
    changes: Array.from({ length: cellCount }, (_, index) => ({ index, color: 0 })),
  };
}

async function runRecoveryFlow(t, directory, { tiled }) {
  const dbPath = join(directory, 'test.db.bin');
  const storagePath = join(directory, 'storage-blocked');
  await writeFile(storagePath, 'blocked', 'utf8');

  let server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: serverEnv({ SQLITE_DB_PATH: dbPath, MEDIA_STORAGE_ROOT: storagePath }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    server?.kill();
  });
  await waitForServer(server);
  await request('/users/me');

  const createBody = tiled
    ? {
        title: 'Outbox tiled recovery',
        storageMode: 'tiled',
        width: 8,
        height: 8,
        tileSize: 32,
        palette: ['#000000', '#ffffff'],
        tiles: [{ tile_x: 0, tile_y: 0, width: 8, height: 8, cells: Array(64).fill(0) }],
      }
    : {
        title: 'Outbox legacy recovery',
        width: 8,
        height: 8,
        palette: ['#000000', '#ffffff'],
        cells: Array(64).fill(0),
      };
  const created = await request('/colorings/create', { method: 'POST', body: createBody });
  assert.equal(created.response.status, 201);
  const templateId = created.json.id;

  const completed = await request(`/colorings/${templateId}/progress/actions`, {
    method: 'POST',
    body: await completionBody(`outbox-${tiled ? 'tiled' : 'legacy'}-001`, 64),
  });
  assert.equal(completed.response.status, 503, 'blocked media must make completion best-effort only');
  assert.equal(completed.json.code, 'MEDIA_RETRY_REQUIRED');
  const artworkId = completed.json.artwork_id;
  assert.ok(artworkId);

  server.kill();
  server = null;
  await new Promise((resolve) => setTimeout(resolve, 300));

  let state = await readOutboxState(dbPath, artworkId);
  assert.ok(state.job, 'durable job must exist after the database commit');
  assert.equal(state.job.status, 'pending');
  assert.equal(state.job.render_mode, tiled ? 'tiled' : 'legacy');
  assert.equal(state.artwork.render_status, 'failed');

  await rm(storagePath, { force: true });
  await mkdir(storagePath, { recursive: true });

  server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: serverEnv({
      SQLITE_DB_PATH: dbPath,
      MEDIA_STORAGE_ROOT: storagePath,
      RENDER_OUTBOX_ENABLED: 'true',
      RENDER_OUTBOX_POLL_MS: '50',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    server?.kill();
  });
  await waitForServer(server);

  const ready = await waitForReady(templateId);
  assert.equal(ready.artwork_id, artworkId);
  assert.equal(ready.render_status, 'ready');

  const published = await request('/posts/create', {
    method: 'POST',
    body: {
      artworkId,
      title: tiled ? 'Published tiled recovery' : 'Published legacy recovery',
      caption: 'Recovered from the durable outbox',
      commentsEnabled: true,
    },
  });
  assert.equal(published.response.status, 201);
  assert.match(published.json.artwork.image_url, /^\/media\//);
  const media = await request(published.json.artwork.image_url);
  assert.equal(media.response.status, 200);

  server.kill();
  server = null;
  await new Promise((resolve) => setTimeout(resolve, 300));
  state = await readOutboxState(dbPath, artworkId);
  assert.equal(state.job.status, 'ready');
  assert.equal(state.artwork.render_status, 'ready');
}

test('legacy completion survives media outage through the durable outbox', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-outbox-legacy-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  await runRecoveryFlow(t, directory, { tiled: false });
});

test('tiled completion enqueues a durable outbox job and drains to publishable', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-outbox-tiled-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  await runRecoveryFlow(t, directory, { tiled: true });
});
