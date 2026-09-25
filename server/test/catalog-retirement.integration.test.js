import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { runMigrations } from '../database/migrations.js';

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(serverDir, 'migrations', 'sqlite');
const port = 31930;
const baseUrl = `http://127.0.0.1:${port}`;
const userId = 'retirement_resume_owner';
const retiredId = 'catalog_retired_fixture';
const currentId = 'catalog_current_fixture';
const collectionId = 'col_retirement_fixture';
const now = '2026-09-25T10:00:00.000Z';

async function stopServer(server) {
  if (server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
}

async function request(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { 'X-User-Id': userId } });
  return { response, json: await response.json() };
}

test('retired catalog work leaves discovery but remains playable and resumable', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-catalog-retirement-'));
  let server = null;
  t.after(async () => {
    if (server) await stopServer(server);
    await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  });
  const dbPath = join(directory, 'retirement.db.bin');
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.run('PRAGMA foreign_keys = ON');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite, persistFn: null, migrationsDir });

  sqlite.run('INSERT INTO users (id,nickname,created_at,updated_at) VALUES (?,?,?,?)',
    [userId, 'Resume Owner', now, now]);
  sqlite.run(`INSERT INTO collections
    (id,title,pack_type,rarity,total_artworks,price_in_stars,image_url,owner_id,status,visibility,description,
     catalog_scope,catalog_slug,catalog_theme,catalog_mood,catalog_tags_json,catalog_rank,catalog_cover_url,catalog_managed)
    VALUES (?,?, 'free','common',2,0,NULL,NULL,'published','public','',
      'merchandising','retirement-fixture','featured','calm','[]',1,NULL,0)`,
  [collectionId, 'Retirement fixture']);

  const cells = JSON.stringify(Array(64).fill(0));
  const palette = JSON.stringify(['#000000', '#ffffff']);
  for (const [id, title, featured, retiredAt] of [
    [retiredId, 'Retired fixture', 0, now],
    [currentId, 'Current fixture', 1, null],
  ]) {
    sqlite.run(`INSERT INTO coloring_templates
      (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,
       original_media_key,source_type,visibility,status,created_at,updated_at,added_at,daily_featured,collection_id,
       theme,storage_mode,tile_size,access_type,featured_rank,catalog_retired_at)
      VALUES (?,NULL,?,'','featured','easy',8,8,?,?,NULL,NULL,'catalog','public','active',?,?,?,?,?,'featured','legacy',32,'free',?,?)`,
    [id, title, palette, cells, now, now, now, featured, collectionId, featured, retiredAt]);
  }
  const filled = Array(64).fill(-1);
  filled[7] = 0;
  sqlite.run(`INSERT INTO coloring_progress
    (user_id,template_id,filled_json,revision,completed_at,created_at,updated_at)
    VALUES (?,?,?,2,NULL,?,?)`, [userId, retiredId, JSON.stringify(filled), now, now]);
  await writeFile(dbPath, Buffer.from(sqlite.export()));
  sqlite.close();

  server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      DATABASE_URL: '',
      SQLITE_DB_PATH: dbPath,
      MEDIA_STORAGE_ROOT: join(directory, 'uploads'),
      ALLOW_DEV_AUTH: 'true',
      SEED_DEMO_DATA: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
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
    server.once('exit', (code) => reject(new Error(`API exited before ready (${code})`)));
  });

  const catalog = await request('/colorings?limit=500');
  assert.equal(catalog.response.status, 200);
  assert.deepEqual(catalog.json.map((item) => item.id), [currentId]);

  const today = await request('/colorings/today');
  assert.equal(today.response.status, 200);
  assert.deepEqual(today.json.newest.map((item) => item.id), [currentId]);

  const shelves = await request('/colorings/shelves');
  assert.equal(shelves.response.status, 200);
  assert.equal(shelves.json.total_count, 1);

  const recommendations = await request('/colorings/recommendations');
  assert.equal(recommendations.response.status, 200);
  assert.ok(recommendations.json.recommendations.every((item) => item.id !== retiredId));

  const collections = await request('/meta/collections');
  const collection = collections.json.find((item) => item.id === collectionId);
  assert.equal(collection.total_count, 1);
  assert.equal(collection.free_count, 1);

  const collectionTemplates = await request(`/meta/collections/${collectionId}/templates`);
  assert.equal(collectionTemplates.response.status, 200);
  assert.deepEqual(collectionTemplates.json.map((item) => item.id), [currentId]);

  const direct = await request(`/colorings/${retiredId}`);
  assert.equal(direct.response.status, 200, 'the retired item remains directly playable');
  const history = await request('/colorings/history');
  assert.equal(history.response.status, 200);
  assert.ok(history.json.some((item) => item.id === retiredId), 'opened retired work stays in personal history');
  const progress = await request(`/colorings/${retiredId}/progress`);
  assert.equal(progress.response.status, 200, 'the owner can still load saved progress');
  assert.equal(progress.json.revision, 2);
  assert.equal(progress.json.filled[7], 0);

  const mine = await request('/colorings/mine');
  assert.equal(mine.response.status, 200);
  assert.ok(mine.json.some((item) => item.id === retiredId), 'the retired in-progress item remains resumable from personal work');
});
