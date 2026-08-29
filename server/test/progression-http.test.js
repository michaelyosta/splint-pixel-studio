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
const basePort = 31923;
const NOW = '2026-08-07T10:00:00.000Z';

async function stopServer(server) {
  if (server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

const ACHIEVEMENTS = [
  ['ach_first_pixel', 'Первый мазок'],
  ['ach_first_zone', 'Зона закрыта'],
  ['ach_daily_3', 'Трёхдневка'],
  ['ach_daily_7', 'Неделя ритма'],
  ['ach_style_night', 'Ночной страж'],
  ['ach_style_forest', 'Лесной след'],
  ['ach_style_space', 'Космический дальнобойщик'],
  ['ach_collector', 'Коллекционер'],
  ['ach_complete_5', 'Пять шедевров'],
];

async function request(path, { userId = 'user_pixelhunter', method = 'GET', body, port = basePort } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { response, json };
}

export function tiledTiles(width, height, tileSize = 32) {
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

export async function seedDatabase(dbPath) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir });

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    for (const [id, title] of ACHIEVEMENTS) {
      await tx.run(`INSERT INTO achievements (id,title,description,category,icon,rarity,created_at)
        VALUES (?,?,?, 'ritual', 'star', 'common', ?)`, [id, title, title, NOW]);
    }
    for (const [id, title] of [['col_night-city', 'Ночной город'], ['col_space', 'Космос'], ['col_cozy-forest', 'Лес']]) {
      await tx.run(`INSERT INTO collections (id,title,pack_type,rarity,total_artworks,price_in_stars,image_url)
        VALUES (?,?, 'free', 'common', 3, 0, NULL)`, [id, title]);
    }

    const legacy = [
      ['leg_night_1', 'night-city', 'col_night-city'],
      ['leg_night_2', 'night-city', 'col_night-city'],
      ['leg_night_3', 'night-city', 'col_night-city'],
      ['leg_forest_1', 'forest', 'col_cozy-forest'],
      ['leg_plain', 'featured', null],
    ];
    for (const [id, theme, collectionId] of legacy) {
      await tx.run(`INSERT INTO coloring_templates
        (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,original_media_key,source_type,visibility,status,created_at,updated_at,storage_mode,tile_size,theme,collection_id)
        VALUES (?,?,?,?, 'test', 'easy', 8, 8, ?, ?, NULL, NULL, 'catalog', 'public', 'active', ?, ?, 'legacy', 32, ?, ?)`,
      [id, null, id, id, JSON.stringify(['#000000', '#ffffff']), JSON.stringify(Array(64).fill(0)), NOW, NOW, theme, collectionId]);
    }

    const tiled = [
      ['tiled_night_1', 'night-city', 'col_night-city', 8, 8],
      ['tiled_night_2', 'night-city', 'col_night-city', 8, 8],
      ['tiled_night_3', 'night-city', 'col_night-city', 8, 8],
      ['tiled_forest_1', 'forest', 'col_cozy-forest', 8, 8],
      ['tiled_plain', 'featured', null, 8, 8],
    ];
    for (const [id, theme, collectionId, width, height] of tiled) {
      await insertTiledTemplate(tx, {
        id,
        ownerId: null,
        title: id,
        description: id,
        width,
        height,
        palette: ['#000000', '#ffffff'],
        visibility: 'public',
        createdAt: NOW,
        updatedAt: NOW,
        tileSize: 32,
        tiles: tiledTiles(width, height),
      });
      await tx.run('UPDATE coloring_templates SET theme=?, collection_id=? WHERE id=?', [theme, collectionId, id]);
    }

    await insertTiledTemplate(tx, {
      id: 'tiled_1200',
      ownerId: null,
      title: 'Tiled 1200 fixture',
      description: 'bounded /mine payload fixture',
      width: 1_200,
      height: 1_200,
      palette: ['#000000', '#ffffff'],
      visibility: 'public',
      createdAt: NOW,
      updatedAt: NOW,
      tileSize: 32,
      tiles: tiledTiles(1_200, 1_200),
    });
    await tx.run('UPDATE coloring_templates SET theme=?, collection_id=NULL WHERE id=?', ['featured', 'tiled_1200']);
  });

  writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
}

async function waitForServer(server) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Progression API server did not start')), 15_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once('error', reject);
  });
}

async function completeTemplate(templateId, userId) {
  const progress = await request(`/colorings/${templateId}/progress`, { userId });
  assert.equal(progress.response.status, 200, `progress for ${templateId}`);
  const changes = Array.from({ length: 64 }, (_, index) => ({ index, color: 0 }));
  return request(`/colorings/${templateId}/progress/actions`, {
    userId,
    method: 'POST',
    body: { revision: progress.json.revision, changes },
  });
}

async function unlockedIds(userId) {
  const response = await request('/meta/achievements', { userId });
  assert.equal(response.response.status, 200);
  return response.json.filter((entry) => entry.unlocked).map((entry) => entry.id).sort();
}

test('legacy and tiled completions grant the same applicable achievements', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-progression-'));
  const dbPath = join(directory, 'fixture.db.bin');
  await seedDatabase(dbPath);

  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL: '',
      PORT: String(basePort),
      SQLITE_DB_PATH: dbPath,
      MEDIA_STORAGE_ROOT: join(directory, 'uploads'),
      ALLOW_DEV_AUTH: 'true',
      RATE_LIMIT_MAX: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    await stopServer(server);
    await rm(directory, { recursive: true, force: true });
  });
  await waitForServer(server);

  const legacyUser = 'parity_legacy';
  const tiledUser = 'parity_tiled';
  for (const id of ['leg_night_1', 'leg_night_2', 'leg_night_3', 'leg_forest_1', 'leg_plain']) {
    const result = await completeTemplate(id, legacyUser);
    assert.equal(result.response.status, 200, `legacy ${id}`);
  }
  for (const id of ['tiled_night_1', 'tiled_night_2', 'tiled_night_3', 'tiled_forest_1', 'tiled_plain']) {
    const result = await completeTemplate(id, tiledUser);
    assert.equal(result.response.status, 200, `tiled ${id}`);
  }

  const legacyUnlocked = await unlockedIds(legacyUser);
  const tiledUnlocked = await unlockedIds(tiledUser);
  assert.deepEqual(legacyUnlocked, tiledUnlocked, 'legacy and tiled users unlock the same achievements');
  for (const id of ['ach_first_pixel', 'ach_first_zone', 'ach_style_night', 'ach_complete_5', 'ach_collector']) {
    assert.ok(legacyUnlocked.includes(id), `${id} must be unlocked by both parity users`);
  }
  for (const id of ['ach_daily_3', 'ach_daily_7', 'ach_style_forest', 'ach_style_space']) {
    assert.equal(legacyUnlocked.includes(id), false, `${id} must not unlock from these completions`);
  }
});

test('/colorings/mine includes tiled progress with a bounded 1200x1200 payload', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-mine-'));
  const dbPath = join(directory, 'fixture.db.bin');
  await seedDatabase(dbPath);

  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL: '',
      PORT: String(basePort + 1),
      SQLITE_DB_PATH: dbPath,
      MEDIA_STORAGE_ROOT: join(directory, 'uploads'),
      ALLOW_DEV_AUTH: 'true',
      RATE_LIMIT_MAX: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    await stopServer(server);
    await rm(directory, { recursive: true, force: true });
  });
  await waitForServer(server);

  const mineUser = 'mine_user';
  const action = await request('/colorings/tiled_1200/progress/actions', {
    userId: mineUser,
    method: 'POST',
    port: basePort + 1,
    body: { revision: 0, clientBatchId: 'mine-tiled-001', changes: [{ index: 0, color: 0 }] },
  });
  assert.equal(action.response.status, 200);

  const mine = await request('/colorings/mine', { userId: mineUser, port: basePort + 1 });
  assert.equal(mine.response.status, 200);
  const item = mine.json.find((entry) => entry.id === 'tiled_1200');
  assert.ok(item, 'tiled-progress-only template must appear in /colorings/mine');
  assert.equal(item.storage_mode, 'tiled');
  assert.equal(item.progress.total_cells, 1_200 * 1_200);
  assert.equal(item.progress.completed_cells, 1);
  assert.equal(Object.hasOwn(item.progress, 'filled'), false, 'no 1.44M filled array is materialized');
  assert.equal(item.content_metadata?.schema_version, 'content-metadata.v1');
  assert.ok(item.content_metadata.duration.label.includes('Длинная'));
  assert.ok(item.content_metadata.complexity.label);
  assert.ok(Buffer.byteLength(JSON.stringify(mine.json)) < 100_000, 'mine payload stays bounded at 1200x1200');
});

test('undo, repaint, replay, and parallel requests cannot farm progression', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-farm-'));
  const dbPath = join(directory, 'fixture.db.bin');
  await seedDatabase(dbPath);

  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL: '',
      PORT: String(basePort + 2),
      SQLITE_DB_PATH: dbPath,
      MEDIA_STORAGE_ROOT: join(directory, 'uploads'),
      ALLOW_DEV_AUTH: 'true',
      RATE_LIMIT_MAX: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    await stopServer(server);
    await rm(directory, { recursive: true, force: true });
  });
  await waitForServer(server);

  const farmUser = 'farm_user';
  const progress = await request('/colorings/leg_plain/progress', { userId: farmUser, port: basePort + 2 });
  assert.equal(progress.response.status, 200);
  const firstBody = {
    revision: progress.json.revision,
    clientBatchId: 'farm-first-001',
    changes: [{ index: 0, color: 0 }],
  };
  const first = await request('/colorings/leg_plain/progress/actions', { userId: farmUser, method: 'POST', port: basePort + 2, body: firstBody });
  assert.equal(first.response.status, 200);
  assert.equal(first.json.rewards.xp_awarded, 1);

  const undo = await request('/colorings/leg_plain/progress/actions', {
    userId: farmUser,
    method: 'POST',
    port: basePort + 2,
    body: { revision: first.json.revision, changes: [{ index: 0, color: -1 }] },
  });
  assert.equal(undo.response.status, 200);
  assert.equal(undo.json.rewards.xp_awarded, 0);

  const repaint = await request('/colorings/leg_plain/progress/actions', {
    userId: farmUser,
    method: 'POST',
    port: basePort + 2,
    body: { revision: undo.json.revision, changes: [{ index: 0, color: 0 }] },
  });
  assert.equal(repaint.response.status, 200);
  assert.equal(repaint.json.rewards.xp_awarded, 0, 'repaint cannot farm XP');

  const replay = await request('/colorings/leg_plain/progress/actions', { userId: farmUser, method: 'POST', port: basePort + 2, body: firstBody });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.json.idempotent, true);
  const progression = await request('/meta/progression', { userId: farmUser, port: basePort + 2 });
  assert.equal(progression.json.xp_total, 1, 'undo, repaint, and replay leave XP at the single first-cell award');
  const streak = await request('/meta/streak', { userId: farmUser, port: basePort + 2 });
  assert.equal(streak.json.current_streak, 1);
  assert.equal(streak.json.done_today, true);

  const achievements = await request('/meta/achievements', { userId: farmUser, port: basePort + 2 });
  const unlocked = achievements.json.filter((entry) => entry.unlocked).map((entry) => entry.id);
  assert.deepEqual(unlocked, ['ach_first_pixel'], 'no threshold achievements unlock from one painted cell');

  const parUser = 'par_user';
  const parResults = await Promise.all([
    request('/colorings/leg_plain/progress/actions', {
      userId: parUser,
      method: 'POST',
      port: basePort + 2,
      body: { revision: 0, clientBatchId: 'par-a-0001', changes: [{ index: 0, color: 0 }] },
    }),
    request('/colorings/leg_plain/progress/actions', {
      userId: parUser,
      method: 'POST',
      port: basePort + 2,
      body: { revision: 0, clientBatchId: 'par-b-0002', changes: [{ index: 1, color: 0 }] },
    }),
  ]);
  assert.deepEqual(parResults.map((entry) => entry.response.status).sort(), [200, 409], 'exactly one parallel first write wins');
  const parProgression = await request('/meta/progression', { userId: parUser, port: basePort + 2 });
  assert.equal(parProgression.json.xp_total, 1, 'parallel first writes award one cell XP');
  const parStreak = await request('/meta/streak', { userId: parUser, port: basePort + 2 });
  assert.equal(parStreak.json.current_streak, 1);
  assert.equal(parStreak.json.total_days, 1);
  const parAchievements = await request('/meta/achievements', { userId: parUser, port: basePort + 2 });
  assert.equal(parAchievements.json.filter((entry) => entry.id === 'ach_first_pixel' && entry.unlocked).length, 1);
});
