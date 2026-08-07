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
const mediaRoot = mkdtempSync(join(tmpdir(), 'splint-render-outbox-'));
process.env.MEDIA_STORAGE_ROOT = mediaRoot;
process.env.STORAGE_DRIVER = 'local';
const {
  claimRenderJobs,
  completeRenderJob,
  drainRenderJobs,
  enqueueRenderJob,
  failRenderJob,
  loadRenderPlan,
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

async function insertLegacyFixture(db, now = BASE_NOW.toISOString()) {
  await withTransaction(db, async (tx) => {
    await tx.run(`INSERT INTO users (id,nickname,role,created_at,updated_at)
      VALUES (?,?,?,?,?)`, ['u1', 'Test User', 'user', now, now]);
    await tx.run(`INSERT INTO coloring_templates
      (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,source_type,visibility,status,est_minutes,created_at,updated_at,storage_mode,tile_size)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['t1', null, 'Legacy', '', 'custom', 'easy', 8, 8, JSON.stringify(['#000000', '#ffffff']), JSON.stringify(Array(64).fill(0)), null, 'user', 'private', 'active', 3, now, now, 'legacy', 32]);
    await tx.run(`INSERT INTO artworks
      (id,owner_id,source_type,image_url,title,template_id,collection_id,collection_title,rarity,is_completed,storage_key,thumbnail_key,content_hash,mime_type,width,height,byte_size,render_status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['art1', 'u1', 'coloring', '/media/art1.png', 'Legacy', 't1', null, 'Legacy', 'common', 1, 'artworks/u1/art1.png', 'thumbnails/u1/art1.png', 'hash', 'image/png', 8, 8, 1, 'pending', now, now]);
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

test('enqueue is deduplicated by artwork and keeps a ready job ready', async () => {
  const db = await createDb();
  await insertLegacyFixture(db);

  const first = await withTransaction(db, (tx) => enqueueRenderJob(tx, {
    artworkId: 'art1',
    userId: 'u1',
    templateId: 't1',
    renderMode: 'legacy',
    now: BASE_NOW,
  }));
  assert.equal(first.status, 'pending');

  await withTransaction(db, (tx) => enqueueRenderJob(tx, {
    artworkId: 'art1',
    userId: 'u1',
    templateId: 't1',
    renderMode: 'legacy',
    now: BASE_NOW,
  }));
  assert.equal(countRows(db, 'SELECT * FROM render_outbox').length, 1, 're-enqueue must not duplicate');

  const claimed = await claimRenderJobs(db, { workerId: 'w1', now: BASE_NOW, leaseMs: 60_000 });
  assert.equal(claimed.length, 1);
  await completeRenderJob(db, {
    jobId: claimed[0].id,
    artworkId: 'art1',
    workerId: 'w1',
    now: BASE_NOW,
  });
  await withTransaction(db, (tx) => enqueueRenderJob(tx, {
    artworkId: 'art1',
    userId: 'u1',
    templateId: 't1',
    renderMode: 'legacy',
    now: BASE_NOW,
  }));
  const ready = countRows(db, "SELECT * FROM render_outbox WHERE artwork_id='art1'")[0];
  assert.equal(ready.status, 'ready');
  assert.equal(countRows(db, 'SELECT * FROM render_outbox').length, 1);
});

test('concurrent claims deliver one job to exactly one worker', async () => {
  const db = await createDb();
  await insertLegacyFixture(db);
  await withTransaction(db, (tx) => enqueueRenderJob(tx, {
    artworkId: 'art1',
    userId: 'u1',
    templateId: 't1',
    renderMode: 'legacy',
    now: BASE_NOW,
  }));

  const [first, second] = await Promise.all([
    claimRenderJobs(db, { workerId: 'worker-a', now: BASE_NOW, leaseMs: 60_000 }),
    claimRenderJobs(db, { workerId: 'worker-b', now: BASE_NOW, leaseMs: 60_000 }),
  ]);
  assert.equal(first.length + second.length, 1, 'exactly one worker may claim');
  assert.deepEqual([first.length, second.length].sort(), [0, 1], 'one worker claims, the other gets nothing');
});

test('active leases are respected and expired leases are reclaimable', async () => {
  const db = await createDb();
  await insertLegacyFixture(db);
  await withTransaction(db, (tx) => enqueueRenderJob(tx, {
    artworkId: 'art1',
    userId: 'u1',
    templateId: 't1',
    renderMode: 'legacy',
    now: BASE_NOW,
  }));

  const first = await claimRenderJobs(db, { workerId: 'w1', now: BASE_NOW, leaseMs: 60_000 });
  assert.equal(first.length, 1);
  const duringLease = await claimRenderJobs(db, {
    workerId: 'w2',
    now: new Date(BASE_NOW.getTime() + 30_000),
    leaseMs: 60_000,
  });
  assert.equal(duringLease.length, 0, 'active lease must not be stolen');

  const afterExpiry = await claimRenderJobs(db, {
    workerId: 'w3',
    now: new Date(BASE_NOW.getTime() + 120_000),
    leaseMs: 60_000,
  });
  assert.equal(afterExpiry.length, 1, 'expired lease must be reclaimable');
  assert.equal(afterExpiry[0].lease_owner, 'w3');
  assert.equal(afterExpiry[0].attempt_count, 2);
});

test('transient failure schedules backoff and final exhaustion transitions to dead', async () => {
  const db = await createDb();
  await insertLegacyFixture(db);
  await withTransaction(db, (tx) => enqueueRenderJob(tx, {
    artworkId: 'art1',
    userId: 'u1',
    templateId: 't1',
    renderMode: 'legacy',
    now: BASE_NOW,
    maxAttempts: 2,
  }));

  const first = await claimRenderJobs(db, { workerId: 'w1', now: BASE_NOW, leaseMs: 60_000 });
  const retry = await failRenderJob(db, {
    jobId: first[0].id,
    artworkId: 'art1',
    workerId: 'w1',
    error: new Error('s3 unavailable'),
    retryDelaysMs: [1_000],
    now: BASE_NOW,
  });
  assert.equal(retry.dead, false);
  let job = countRows(db, "SELECT * FROM render_outbox WHERE artwork_id='art1'")[0];
  assert.equal(job.status, 'retry');
  assert.equal(job.attempt_count, 1);
  assert.equal(job.next_attempt_at, '2026-01-01T00:00:01.000Z');
  assert.match(job.last_error, /s3 unavailable/);
  assert.equal(countRows(db, "SELECT render_status FROM artworks WHERE id='art1'")[0].render_status, 'failed');

  const second = await claimRenderJobs(db, {
    workerId: 'w2',
    now: new Date('2026-01-01T00:00:02.000Z'),
    leaseMs: 60_000,
  });
  assert.equal(second.length, 1);
  const dead = await failRenderJob(db, {
    jobId: second[0].id,
    artworkId: 'art1',
    workerId: 'w2',
    error: new Error('s3 still down'),
    retryDelaysMs: [1_000],
    now: new Date('2026-01-01T00:00:02.000Z'),
  });
  assert.equal(dead.dead, true);
  job = countRows(db, "SELECT * FROM render_outbox WHERE artwork_id='art1'")[0];
  assert.equal(job.status, 'dead');
  assert.equal(job.attempt_count, 2);
});

test('drain writes both canonical objects before marking artwork and job ready', async () => {
  const db = await createDb();
  await insertLegacyFixture(db);
  await withTransaction(db, async (tx) => {
    await tx.run(`INSERT INTO coloring_progress (user_id,template_id,filled_json,revision,completed_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`, ['u1', 't1', JSON.stringify(Array(64).fill(0)), 1, BASE_NOW.toISOString(), BASE_NOW.toISOString(), BASE_NOW.toISOString()]);
    await enqueueRenderJob(tx, {
      artworkId: 'art1',
      userId: 'u1',
      templateId: 't1',
      renderMode: 'legacy',
      now: BASE_NOW,
    });
  });

  const results = await drainRenderJobs(db, { workerId: 'w1', now: BASE_NOW, leaseMs: 60_000 });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'ready');

  const full = readFileSync(join(mediaRoot, 'artworks', 'u1', 'art1.png'));
  const thumb = readFileSync(join(mediaRoot, 'thumbnails', 'u1', 'art1.png'));
  assert.equal(full.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(thumb.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const job = countRows(db, "SELECT * FROM render_outbox WHERE artwork_id='art1'")[0];
  const artwork = countRows(db, "SELECT render_status FROM artworks WHERE id='art1'")[0];
  assert.equal(job.status, 'ready');
  assert.equal(artwork.render_status, 'ready');
});

test('tiled 1200 render plan never assembles a full filled array', async () => {
  const db = await createDb();
  const now = BASE_NOW.toISOString();
  const width = 1_200;
  const height = 1_200;
  const tileSize = 128;
  const tilesX = Math.ceil(width / tileSize);
  const tilesY = Math.ceil(height / tileSize);

  await withTransaction(db, async (tx) => {
    await tx.run(`INSERT INTO users (id,nickname,role,created_at,updated_at)
      VALUES (?,?,?,?,?)`, ['u1200', 'Tiled User', 'user', now, now]);
    await tx.run(`INSERT INTO coloring_templates
      (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,source_type,visibility,status,est_minutes,created_at,updated_at,storage_mode,tile_size)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['t1200', null, 'Tiled 1200', '', 'custom', 'custom', width, height, JSON.stringify(['#000000', '#ffffff']), JSON.stringify([]), null, 'user', 'private', 'active', 3, now, now, 'tiled', tileSize]);
    for (let tileY = 0; tileY < tilesY; tileY += 1) {
      for (let tileX = 0; tileX < tilesX; tileX += 1) {
        const tileWidth = Math.min(tileSize, width - tileX * tileSize);
        const tileHeight = Math.min(tileSize, height - tileY * tileSize);
        await tx.run(`INSERT INTO coloring_template_tiles
          (template_id,tile_x,tile_y,width,height,cells_json,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?)`,
        ['t1200', tileX, tileY, tileWidth, tileHeight, JSON.stringify(Array(tileWidth * tileHeight).fill(0)), now, now]);
      }
    }
    await tx.run(`INSERT INTO coloring_tiled_progress
      (user_id,template_id,revision,completed_cells,completed_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`, ['u1200', 't1200', 1, width * height, now, now, now]);
    await tx.run(`INSERT INTO artworks
      (id,owner_id,source_type,image_url,title,template_id,collection_id,collection_title,rarity,is_completed,storage_key,thumbnail_key,content_hash,mime_type,width,height,byte_size,render_status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['art1200', 'u1200', 'coloring', '/media/art1200.png', 'Tiled 1200', 't1200', null, 'Tiled 1200', 'common', 1, 'artworks/u1200/art1200.png', 'thumbnails/u1200/art1200.png', 'hash', 'image/png', width, height, 1, 'pending', now, now]);
    await enqueueRenderJob(tx, {
      artworkId: 'art1200',
      userId: 'u1200',
      templateId: 't1200',
      renderMode: 'tiled',
      now: BASE_NOW,
    });
  });

  const job = countRows(db, "SELECT * FROM render_outbox WHERE artwork_id='art1200'")[0];
  const plan = await loadRenderPlan(db, job);
  assert.equal(plan.renderMode, 'tiled');
  assert.equal(plan.width, width);
  assert.equal(plan.height, height);
  assert.equal(plan.tiles.length, tilesX * tilesY);
  assert.equal('filled' in plan, false, 'tiled plan must not build a full filled map');
  assert.equal(Object.hasOwn(plan, 'cells'), false);
  assert.equal(plan.tiles[0].cells.length, tileSize * tileSize);
});
