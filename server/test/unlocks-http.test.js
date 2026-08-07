import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { runMigrations } from '../database/migrations.js';
import { withTransaction } from '../database/transaction.js';
import { insertTiledTemplate } from '../services/tiled-coloring.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..');
const migrationsDir = join(serverDir, 'migrations', 'sqlite');
const basePort = 31940;
const NOW = '2026-08-07T10:00:00.000Z';

function tiledTiles(width, height, tileSize = 32) {
  const tiles = [];
  const tilesX = Math.ceil(width / tileSize);
  const tilesY = Math.ceil(height / tileSize);
  for (let tileY = 0; tileY < tilesY; tileY += 1) {
    for (let tileX = 0; tileX < tilesX; tileX += 1) {
      const tileWidth = Math.min(tileSize, width - tileX * tileSize);
      const tileHeight = Math.min(tileSize, height - tileY * tileSize);
      tiles.push({
        tile_x: tileX,
        tile_y: tileY,
        width: tileWidth,
        height: tileHeight,
        cells: Array(tileWidth * tileHeight).fill(0),
      });
    }
  }
  return tiles;
}

async function seedDatabase(dbPath) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir });

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const users = [
      ['user_eligible', 2, 1_000],
      ['user_premium', 99, 99_000],
      ['user_concurrent', 2, 1_000],
      ['user_streak', 1, 0],
    ];
    for (const [id, level, xp] of users) {
      await tx.run(`INSERT INTO users (id,nickname,role,created_at,updated_at)
        VALUES (?,?, 'user', ?, ?)`, [id, id, NOW, NOW]);
      await tx.run('UPDATE users SET level=?, xp_total=? WHERE id=?', [level, xp, id]);
    }
    await tx.run(`INSERT INTO achievements (id,title,description,category,icon,rarity,created_at)
      VALUES ('ach_first_zone','Первая зона','Описание','ritual','star','common',?)`, [NOW]);
    await tx.run(`INSERT INTO daily_streaks
      (user_id,current_streak,longest_streak,total_days,last_active_date,created_at,updated_at)
      VALUES ('user_streak',3,3,3,'2026-08-07',?,?)`, [NOW, NOW]);

    const collections = [
      ['col_starter-path', 'free', 0],
      ['col_premium-gallery', 'premium', 50],
      ['col_master-gallery', 'free', 0],
    ];
    for (const [id, packType, price] of collections) {
      await tx.run(`INSERT INTO collections
        (id,title,pack_type,rarity,total_artworks,price_in_stars,image_url,owner_id,status,visibility,description)
        VALUES (?,?,?, 'common', 1, ?, NULL, NULL, 'published', 'public', '')`,
      [id, id, packType, price]);
    }

    const legacy = [
      ['leg_free', 'featured', null, 'catalog'],
      ['starter_1', 'night-city', 'col_starter-path', 'unlockable'],
      ['starter_2', 'forest', 'col_starter-path', 'unlockable'],
      ['premium_1', 'space', 'col_premium-gallery', 'unlockable'],
      ['master_1', 'space', 'col_master-gallery', 'unlockable'],
      ['streak_badge', 'featured', null, 'unlockable'],
      ['hidden_locked', 'night-city', null, 'unlockable'],
    ];
    for (const [id, theme, collectionId, sourceType] of legacy) {
      const hidden = id === 'hidden_locked' ? 'hidden' : 'active';
      await tx.run(`INSERT INTO coloring_templates
        (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,original_media_key,source_type,visibility,status,created_at,updated_at,storage_mode,tile_size,theme,collection_id)
        VALUES (?,?,?,?, 'test', 'easy', 8, 8, ?, ?, NULL, NULL, ?, 'public', ?, ?, ?, 'legacy', 32, ?, ?)`,
      [id, null, id, id, JSON.stringify(['#000000', '#ffffff']), JSON.stringify(Array(64).fill(0)), sourceType, hidden, NOW, NOW, theme, collectionId]);
    }

    await insertTiledTemplate(tx, {
      id: 'tiled_1200',
      ownerId: null,
      title: 'Tiled 1200 fixture',
      description: 'bounded recommendation fixture',
      width: 1_200,
      height: 1_200,
      palette: ['#000000', '#ffffff'],
      visibility: 'public',
      createdAt: NOW,
      updatedAt: NOW,
      tileSize: 32,
      tiles: tiledTiles(1_200, 1_200),
    });
    await tx.run("UPDATE coloring_templates SET theme='night-city', source_type='unlockable', collection_id=NULL WHERE id='tiled_1200'");

    const rules = [
      ['collection', 'col_starter-path', 'level', '2'],
      ['collection', 'col_starter-path', 'completed_artworks', '1'],
      ['collection', 'col_master-gallery', 'collection_completion', 'col_starter-path'],
      ['template', 'streak_badge', 'streak', '3'],
      ['template', 'hidden_locked', 'level', '1'],
    ];
    for (const [subjectType, subjectId, ruleType, targetValue] of rules) {
      await tx.run(`INSERT INTO unlock_rules
        (subject_type,subject_id,rule_type,target_value,rule_order,created_at)
        VALUES (?,?,?,?,1,?)`, [subjectType, subjectId, ruleType, targetValue, NOW]);
    }

    for (const userId of ['user_eligible', 'user_concurrent']) {
      await tx.run(`INSERT INTO artworks
        (id,owner_id,source_type,image_url,title,template_id,collection_id,is_completed,created_at,updated_at)
        VALUES (?,?, 'coloring', '/media/x.png', 'done', 'leg_free', NULL, 1, ?, ?)`,
      [`art_${userId}`, userId, NOW, NOW]);
    }
  });

  writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
}

async function request(port, path, { userId = 'fresh_user', method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { ...(userId ? { 'X-User-Id': userId } : {}), 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { response, json };
}

async function startServer(directory, port) {
  const dbPath = join(directory, 'fixture.db.bin');
  await seedDatabase(dbPath);
  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL: '',
      PORT: String(port),
      SQLITE_DB_PATH: dbPath,
      MEDIA_STORAGE_ROOT: join(directory, 'uploads'),
      ALLOW_DEV_AUTH: 'true',
      RATE_LIMIT_MAX: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Unlocks API server did not start')), 15_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once('error', reject);
  });
  return server;
}

async function withServer(t, port, fn) {
  const directory = await mkdtemp(join(tmpdir(), 'splint-unlocks-'));
  const server = await startServer(directory, port);
  t.after(async () => {
    server.kill();
    await rm(directory, { recursive: true, force: true });
  });
  return fn(port);
}

test('unlock endpoints require auth and return a bounded snapshot', async (t) => {
  const port = basePort;
  await withServer(t, port, async () => {
    const me = await request(port, '/unlocks/me', { userId: null });
    assert.equal(me.response.status, 401);
    const recs = await request(port, '/colorings/recommendations', { userId: null });
    assert.equal(recs.response.status, 401);
    const locked = await request(port, '/colorings/starter_1', { userId: null });
    assert.equal(locked.response.status, 401);

    const snapshot = await request(port, '/unlocks/me');
    assert.equal(snapshot.response.status, 200);
    assert.ok(snapshot.json.progression_facts.level >= 1);
    assert.equal(snapshot.json.summary.premium_locked >= 1, true);
    assert.ok(snapshot.json.next_actionable.length >= 1);
    assert.ok(snapshot.json.next_actionable.every((item) => item.requirements && Array.isArray(item.requirements)));
    assert.ok(Buffer.byteLength(JSON.stringify(snapshot.json)) < 100_000, 'snapshot payload stays bounded');

    const template = await request(port, '/unlocks/templates/streak_badge');
    assert.equal(template.response.status, 200);
    assert.equal(template.json.state, 'progression_locked');
    assert.equal(template.json.reason_code, 'PROGRESSION_REQUIRED');
    assert.equal(template.json.requirements[0].reason_code, 'STREAK_REQUIRED');

    const collection = await request(port, '/unlocks/collections/col_starter-path');
    assert.equal(collection.response.status, 200);
    assert.equal(collection.json.state, 'progression_locked');
    assert.ok(collection.json.requirements.some((item) => item.reason_code === 'LEVEL_REQUIRED'));
    assert.ok(collection.json.requirements.some((item) => item.reason_code === 'COMPLETIONS_REQUIRED'));
  });
});

test('direct-ID read/start bypass fails; premium stays purchase-only', async (t) => {
  const port = basePort + 1;
  await withServer(t, port, async () => {
    for (const path of [
      '/colorings/starter_1',
      '/colorings/starter_1/manifest',
      '/colorings/starter_1/tiles/0/0',
      '/colorings/starter_1/zones',
      '/colorings/starter_1/progress',
    ]) {
      const blocked = await request(port, path);
      assert.equal(blocked.response.status, 403, `${path} must reject direct-ID bypass`);
      assert.equal(blocked.json.code, 'PROGRESSION_REQUIRED');
    }
    const favorite = await request(port, '/colorings/starter_1/favorite', { method: 'PUT' });
    assert.equal(favorite.response.status, 403);
    const action = await request(port, '/colorings/starter_1/progress/actions', {
      method: 'POST',
      body: { revision: 0, changes: [{ index: 0, color: 0 }] },
    });
    assert.equal(action.response.status, 403);
    const snapshot = await request(port, '/unlocks/me');
    assert.equal(snapshot.json.progression_facts.owned_collections, 0, 'blocked action created no entitlement');

    const premiumBlocked = await request(port, '/colorings/premium_1', { userId: 'user_premium' });
    assert.equal(premiumBlocked.response.status, 403, 'high level cannot bypass premium');
    assert.equal(premiumBlocked.json.code, 'PREMIUM_REQUIRED');

    await request(port, '/users/user_premium/add-stars', { userId: 'user_premium', method: 'POST' });
    const purchase = await request(port, '/users/collections/col_premium-gallery/add', {
      userId: 'user_premium',
      method: 'POST',
      headers: { 'Idempotency-Key': 'premium-unlock-http-001' },
    });
    assert.equal(purchase.response.status, 200);
    const premiumOpened = await request(port, '/colorings/premium_1', { userId: 'user_premium' });
    assert.equal(premiumOpened.response.status, 200);
    assert.equal(premiumOpened.json.unlock_state, 'owned');
    const premiumManifest = await request(port, '/colorings/premium_1/manifest', { userId: 'user_premium' });
    assert.equal(premiumManifest.response.status, 200);
  });
});

test('lazy backfill, replay, and concurrent first unlock materialize one ownership', async (t) => {
  const port = basePort + 2;
  await withServer(t, port, async () => {
    const first = await request(port, '/colorings/starter_1', { userId: 'user_eligible' });
    assert.equal(first.response.status, 200, 'eligible old user is backfilled lazily');
    assert.equal(first.json.unlock_granted, true);
    const replay = await request(port, '/colorings/starter_1', { userId: 'user_eligible' });
    assert.equal(replay.response.status, 200);
    assert.equal(replay.json.unlock_granted, false, 'replay cannot double grant');
    const owned = await request(port, '/unlocks/collections/col_starter-path', { userId: 'user_eligible' });
    assert.equal(owned.json.state, 'owned');

    const parallel = await Promise.all([
      request(port, '/colorings/starter_1', { userId: 'user_concurrent' }),
      request(port, '/colorings/starter_1', { userId: 'user_concurrent' }),
    ]);
    assert.deepEqual(parallel.map((item) => item.response.status), [200, 200]);
    const concurrentSnapshot = await request(port, '/unlocks/me', { userId: 'user_concurrent' });
    assert.equal(concurrentSnapshot.json.progression_facts.owned_collections, 1, 'concurrent first unlock yields one ownership');
    const concurrentOwned = await request(port, '/unlocks/collections/col_starter-path', { userId: 'user_concurrent' });
    assert.equal(concurrentOwned.json.state, 'owned');

    const streak = await request(port, '/colorings/streak_badge', { userId: 'user_streak' });
    assert.equal(streak.response.status, 200);
    assert.equal(streak.json.unlock_state, 'owned');
    const streakReplay = await request(port, '/colorings/streak_badge', { userId: 'user_streak' });
    assert.equal(streakReplay.json.unlock_granted, false);
  });
});

test('recommendations use tiled+legacy history, exclude locked/hidden/completed, and stay bounded', async (t) => {
  const port = basePort + 3;
  await withServer(t, port, async () => {
    const progress = await request(port, '/colorings/tiled_1200/progress', { userId: 'fresh_user' });
    assert.equal(progress.response.status, 200);
    await request(port, '/colorings/tiled_1200/progress/actions', {
      userId: 'fresh_user',
      method: 'POST',
      body: { revision: progress.json.revision, clientBatchId: 'rec-tiled-001', changes: [{ index: 0, color: 0 }] },
    });
    const cold = await request(port, '/colorings/recommendations', { userId: 'fresh_user' });
    assert.equal(cold.response.status, 200);
    const tiledItem = cold.json.recommendations.find((item) => item.id === 'tiled_1200');
    assert.ok(tiledItem, 'in-progress tiled row is recommended to continue');
    assert.equal(tiledItem.reason_code, 'CONTINUE_PROGRESS');
    assert.equal(tiledItem.total_cells, 1_200 * 1_200);
    assert.ok(cold.json.recommendations.every((item) => !Object.hasOwn(item, 'filled') && !Object.hasOwn(item, 'cells')));
    assert.ok(cold.json.recommendations.every((item) => item.id !== 'hidden_locked' && item.id !== 'premium_1' && item.id !== 'starter_1'));
    assert.ok(Buffer.byteLength(JSON.stringify(cold.json)) < 100_000, 'recommendation payload stays bounded at 1200x1200');

    const personalized = await request(port, '/colorings/recommendations', { userId: 'user_eligible' });
    assert.equal(personalized.response.status, 200);
    assert.equal(personalized.json.cold_start, false);
    assert.ok(personalized.json.recommendations.every((item) => item.id !== 'leg_free'), 'completed legacy artwork is excluded');
    assert.ok(personalized.json.recommendations.some((item) => item.id === 'starter_1' || item.id === 'starter_2'), 'satisfied unlockable content is recommended');
  });
});

test('legacy catalog and daily challenge ignore unlockable content', async (t) => {
  const port = basePort + 4;
  await withServer(t, port, async () => {
    const catalog = await request(port, '/colorings?sort=new&limit=100');
    assert.equal(catalog.response.status, 200);
    const ids = catalog.json.map((item) => item.id);
    assert.ok(ids.includes('leg_free'));
    assert.ok(!ids.includes('starter_1'), 'unlockable content is not forced into the legacy catalog');
    assert.ok(!ids.includes('premium_1'));
    const today = await request(port, '/colorings/today');
    assert.ok(!today.json.quick.some((item) => item.id === 'starter_1'));

    const daily = await request(port, '/meta/daily-challenge');
    assert.equal(daily.response.status, 200);
    assert.equal(daily.json.template_id, 'leg_free', 'daily challenge never assigns gated or premium content');

    const freeDetail = await request(port, '/colorings/leg_free');
    assert.equal(freeDetail.response.status, 200);
    assert.equal(freeDetail.json.unlock_state, 'available');
  });
});
