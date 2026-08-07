import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { runMigrations } from '../database/migrations.js';
import { withTransaction } from '../database/transaction.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..');
const mediaRoot = mkdtempSync(join(tmpdir(), 'splint-tiled-arch-'));
process.env.MEDIA_STORAGE_ROOT = mediaRoot;
process.env.STORAGE_DRIVER = 'local';
const {
  claimRenderJobs,
  completeRenderJob,
  drainRenderJobs,
  enqueueRenderJob,
  processRenderJob,
} = await import('../services/render-outbox.js');

after(() => {
  rmSync(mediaRoot, { recursive: true, force: true });
});

const BASE_NOW = new Date('2026-01-01T00:00:00.000Z');

async function createDb() {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.run('PRAGMA foreign_keys = ON;');
  await runMigrations({
    mode: 'sqlite',
    pool: null,
    sqlite,
    persistFn: null,
    migrationsDir: join(serverDir, 'migrations', 'sqlite'),
  });
  return { mode: 'sqlite', sqlite };
}

async function insertTiledFixture(db) {
  const now = BASE_NOW.toISOString();
  await withTransaction(db, async (tx) => {
    await tx.run(`INSERT INTO users (id,nickname,role,created_at,updated_at)
      VALUES (?,?,?,?,?)`, ['u1', 'Test User', 'user', now, now]);
    await tx.run(`INSERT INTO coloring_templates
      (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,source_type,visibility,status,est_minutes,created_at,updated_at,storage_mode,tile_size)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['tiled1', null, 'Tiled', '', 'custom', 'easy', 8, 8, JSON.stringify(['#000000', '#ffffff']), JSON.stringify([]), null, 'user', 'private', 'active', 3, now, now, 'tiled', 32]);
    await tx.run(`INSERT INTO coloring_template_tiles
      (template_id,tile_x,tile_y,width,height,cells_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`,
    ['tiled1', 0, 0, 8, 8, JSON.stringify(Array(64).fill(0)), now, now]);
    await tx.run(`INSERT INTO artworks
      (id,owner_id,source_type,image_url,title,template_id,collection_id,collection_title,rarity,is_completed,storage_key,thumbnail_key,content_hash,mime_type,width,height,byte_size,render_status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['art_tiled1', 'u1', 'coloring', '/media/art_tiled1.png', 'Tiled', 'tiled1', null, 'Tiled', 'common', 1, 'artworks/u1/art_tiled1.png', 'thumbnails/u1/art_tiled1.png', null, 'image/png', 8, 8, 0, 'pending', now, now]);
  });
  return db;
}

function countRows(db, sql, params = []) {
  const stmt = db.sqlite.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

test('tiled worker retry reaches ready exactly once and never duplicates artwork', async () => {
  const db = await createDb();
  await insertTiledFixture(db);
  await withTransaction(db, (tx) => enqueueRenderJob(tx, {
    artworkId: 'art_tiled1',
    userId: 'u1',
    templateId: 'tiled1',
    renderMode: 'tiled',
    now: BASE_NOW,
  }));

  let attempts = 0;
  const flakyRenderJob = async (currentDb, job) => {
    attempts += 1;
    if (attempts === 1) throw new Error('transient media failure');
    return processRenderJob(currentDb, job);
  };

  const first = await drainRenderJobs(db, {
    workerId: 'w1',
    now: BASE_NOW,
    renderJob: flakyRenderJob,
  });
  assert.equal(first[0].ok, false);
  assert.equal(first[0].status, 'retry');
  assert.equal(countRows(db, "SELECT render_status FROM artworks WHERE id='art_tiled1'")[0].render_status, 'failed');

  const retryAt = new Date(countRows(db, "SELECT next_attempt_at FROM render_outbox WHERE artwork_id='art_tiled1'")[0].next_attempt_at);
  const second = await drainRenderJobs(db, {
    workerId: 'w1',
    now: new Date(retryAt.getTime() + 1_000),
    renderJob: flakyRenderJob,
  });
  assert.equal(second[0].ok, true);
  assert.equal(second[0].status, 'ready');
  assert.equal(countRows(db, "SELECT render_status FROM artworks WHERE id='art_tiled1'")[0].render_status, 'ready');
  assert.equal(countRows(db, 'SELECT * FROM render_outbox WHERE artwork_id=?', ['art_tiled1'])[0].status, 'ready');
  assert.equal(countRows(db, "SELECT id FROM artworks WHERE template_id='tiled1'").length, 1);
  assert.equal(attempts, 2);
});

test('reprocessing a ready tiled job is a no-op', async () => {
  const db = await createDb();
  await insertTiledFixture(db);
  await withTransaction(db, (tx) => enqueueRenderJob(tx, {
    artworkId: 'art_tiled1',
    userId: 'u1',
    templateId: 'tiled1',
    renderMode: 'tiled',
    now: BASE_NOW,
  }));
  await drainRenderJobs(db, { workerId: 'w1', now: BASE_NOW });

  const claimedAgain = await claimRenderJobs(db, {
    workerId: 'w2',
    now: new Date(BASE_NOW.getTime() + 60_000),
    leaseMs: 60_000,
  });
  assert.equal(claimedAgain.length, 0, 'ready jobs are never reclaimed');
  const completed = await completeRenderJob(db, {
    jobId: 'render:art_tiled1',
    artworkId: 'art_tiled1',
    workerId: 'w2',
    now: BASE_NOW,
  });
  assert.equal(completed.updated, false);
  assert.equal(countRows(db, "SELECT id FROM artworks WHERE template_id='tiled1'").length, 1);
});

test('tiled completion/read route must not render or re-read all tiles', () => {
  const source = readFileSync(join(serverDir, 'routes', 'colorings.js'), 'utf8');
  const progressSection = source.slice(source.indexOf("router.get('/:id/progress'"), source.indexOf("// Full canonical results stay private"));
  assert.doesNotMatch(progressSection, /readTiledTemplateTiles/);
  assert.doesNotMatch(progressSection, /renderCanonicalTiled/);
  assert.doesNotMatch(progressSection, /prepareTiledArtwork/);

  const actionSection = source.slice(source.indexOf('async function processTiledProgressAction'), source.indexOf('// POST /colorings/:id/progress/actions'));
  assert.doesNotMatch(actionSection, /renderCanonicalTiled/);
  assert.doesNotMatch(actionSection, /storeMediaObject/);
  assert.doesNotMatch(actionSection, /persistTiledArtworkMedia/);
  assert.match(actionSection, /enqueueRenderJob/);
  assert.match(actionSection, /createTiledArtworkMetadata/);
});
