import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { runMigrations } from '../database/migrations.js';

// F03: /meta/collections/:id/templates must normalize access consistently
// with /colorings (access === access_type), expose no raster maps or
// private storage keys, and report honest total_cells for tiled templates.
// Merchandising browse stays permitted for owner and non-owner alike while
// the per-item template read gate stays fail-closed.
const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(serverDir, 'migrations', 'sqlite');
const port = 31941;
const baseUrl = `http://127.0.0.1:${port}`;
const ownerId = 'dto_collection_owner';
const guestId = 'dto_collection_guest';
const collectionId = 'col_dto_dreamcore';
const now = '2026-09-29T10:00:00.000Z';
const PREMIUM_COUNT = 20;

async function stopServer(server) {
  if (server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
}

async function requestAs(userId, path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { 'X-User-Id': userId } });
  return { response, json: await response.json() };
}

test('collection templates DTO normalizes premium access without leaking maps', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-collection-dto-'));
  let server = null;
  t.after(async () => {
    if (server) await stopServer(server);
    await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  });
  const dbPath = join(directory, 'collection-dto.db.bin');
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.run('PRAGMA foreign_keys = ON');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite, persistFn: null, migrationsDir });

  for (const [id, nickname] of [[ownerId, 'DTO Owner'], [guestId, 'DTO Guest']]) {
    sqlite.run('INSERT INTO users (id,nickname,created_at,updated_at) VALUES (?,?,?,?)',
      [id, nickname, now, now]);
  }
  sqlite.run(`INSERT INTO collections
    (id,title,pack_type,rarity,total_artworks,price_in_stars,image_url,owner_id,status,visibility,description,
     catalog_scope,catalog_slug,catalog_theme,catalog_mood,catalog_tags_json,catalog_rank,catalog_cover_url,catalog_managed)
    VALUES (?,?, 'premium','rare',21,120,NULL,?,'published','public','Dreamcore DTO fixture',
      'merchandising','dto-dreamcore','featured','vivid','[]',1,NULL,0)`,
  [collectionId, 'Dreamcore DTO', ownerId]);

  const cells = JSON.stringify(Array(64).fill(0));
  const palette = JSON.stringify(['#000000', '#ffffff']);
  for (let i = 0; i < PREMIUM_COUNT; i += 1) {
    const id = `dto_dreamcore_${String(i).padStart(2, '0')}`;
    sqlite.run(`INSERT INTO coloring_templates
      (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,
       original_media_key,source_type,visibility,status,created_at,updated_at,added_at,daily_featured,collection_id,
       theme,storage_mode,tile_size,access_type,featured_rank,catalog_retired_at)
      VALUES (?,NULL,?,'','featured','easy',8,8,?,?,'preview.png','private/original.png','catalog','public','active',?,?,?,?,?,'featured','legacy',32,'premium',?,NULL)`,
    [id, `Dreamcore DTO ${i}`, palette, cells, now, now, now, 0, collectionId, i]);
  }
  sqlite.run(`INSERT INTO coloring_templates
    (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,
     original_media_key,source_type,visibility,status,created_at,updated_at,added_at,daily_featured,collection_id,
     theme,storage_mode,tile_size,access_type,featured_rank,catalog_retired_at)
    VALUES ('dto_dreamcore_tiled',NULL,'Dreamcore DTO tiled','','featured','easy',1200,1200,?,'[]','preview.png','private/original.png','catalog','public','active',?,?,?,?,?,'featured','tiled',32,'premium',?,NULL)`,
  [palette, now, now, now, 0, collectionId, PREMIUM_COUNT]);
  await writeFile(dbPath, Buffer.from(sqlite.export()));
  sqlite.close();

  server = spawn(process.execPath, ['index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      DATABASE_URL: '',
      STORAGE_DRIVER: 'local',
      SQLITE_DB_PATH: dbPath,
      MEDIA_STORAGE_ROOT: join(directory, 'uploads'),
      ALLOW_DEV_AUTH: 'true',
      SEED_DEMO_DATA: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API did not start')), 15_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once('error', reject);
    server.once('exit', (code) => reject(new Error(`API exited before ready (${code})`)));
  });

  const ownerBrowse = await requestAs(ownerId, `/meta/collections/${collectionId}/templates`);
  assert.equal(ownerBrowse.response.status, 200);
  assert.equal(ownerBrowse.json.length, PREMIUM_COUNT + 1);

  const guestBrowse = await requestAs(guestId, `/meta/collections/${collectionId}/templates`);
  assert.equal(guestBrowse.response.status, 200);
  assert.deepEqual(
    guestBrowse.json.map((item) => item.id),
    ownerBrowse.json.map((item) => item.id),
  );

  for (const item of guestBrowse.json) {
    assert.equal(item.access, 'premium');
    assert.equal(item.access_type, 'premium');
    for (const forbidden of ['cells', 'cells_json', 'palette_json', 'original_media_key']) {
      assert.ok(!(forbidden in item), `${item.id} must not expose ${forbidden}`);
    }
  }

  const legacy = guestBrowse.json.filter((item) => item.id !== 'dto_dreamcore_tiled');
  assert.equal(legacy.length, PREMIUM_COUNT);
  for (const item of legacy) {
    assert.equal(item.total_cells, 64);
  }
  const tiled = guestBrowse.json.find((item) => item.id === 'dto_dreamcore_tiled');
  assert.equal(tiled.total_cells, 1200 * 1200);

  // The per-item read gate stays fail-closed: browse never grants access.
  const gated = await requestAs(guestId, '/colorings/dto_dreamcore_00/manifest');
  assert.equal(gated.response.status, 403);
  assert.match(String(gated.json.code || ''), /PREMIUM/);
});
