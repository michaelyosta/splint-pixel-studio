import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createFreshSqliteDbAsync, serverDir } from './helpers/database.js';
import { runMigrations } from '../database/migrations.js';
import { withTransaction } from '../database/transaction.js';
import { buildRecommendations } from '../services/recommendations.js';
import { insertTiledTemplate } from '../services/tiled-coloring.js';

const MIGRATIONS_DIR = join(serverDir, 'migrations', 'sqlite');
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

async function createDb() {
  const db = await createFreshSqliteDbAsync();
  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir: MIGRATIONS_DIR });
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const users = ['u_cold', 'u_personal', 'u_dual'];
    for (const userId of users) {
      await tx.run(`INSERT INTO users (id,nickname,role,created_at,updated_at)
        VALUES (?,?, 'user', ?, ?)`, [userId, userId, NOW, NOW]);
    }
    for (const [id, title] of [['col_night-city', 'Ночь'], ['col_space', 'Космос'], ['col_premium-gallery', 'Премиум']]) {
      await tx.run(`INSERT INTO collections
        (id,title,pack_type,rarity,total_artworks,price_in_stars,image_url,owner_id,status,visibility,description)
        VALUES (?,?, 'free', 'common', 3, 0, NULL, NULL, 'published', 'public', '')`,
      [id, title]);
    }
    await tx.run(`UPDATE collections SET pack_type='premium', price_in_stars=50 WHERE id='col_premium-gallery'`);
  });
  return db;
}

async function insertLegacyTemplate(db, id, { theme = 'featured', collectionId = null, hidden = false, difficulty = 'easy', width = 8, height = 8, ownerId = null } = {}) {
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    await tx.run(`INSERT INTO coloring_templates
      (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,original_media_key,source_type,visibility,status,created_at,updated_at,storage_mode,tile_size,theme,collection_id)
      VALUES (?,?,?,?, 'test', ?, ?, ?, ?, ?, NULL, NULL, 'catalog', 'public', ?, ?, ?, 'legacy', 32, ?, ?)`,
    [id, ownerId, id, id, difficulty, width, height, JSON.stringify(['#000000', '#ffffff']), JSON.stringify(Array(width * height).fill(0)), hidden ? 'hidden' : 'active', NOW, NOW, theme, collectionId]);
  });
}

async function insertTiled(db, id, { theme = 'featured', collectionId = null, width = 8, height = 8, difficulty = 'easy' } = {}) {
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
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
    await tx.run('UPDATE coloring_templates SET theme=?, collection_id=?, difficulty=? WHERE id=?', [theme, collectionId, difficulty, id]);
  });
}

async function insertRule(db, subjectType, subjectId, ruleType, targetValue) {
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    await tx.run(`INSERT INTO unlock_rules
      (subject_type,subject_id,rule_type,target_value,rule_order,created_at)
      VALUES (?,?,?,?,1,?)`, [subjectType, subjectId, ruleType, targetValue, NOW]);
  });
}

async function addHistory(db, userId, { completed = [], inProgressTiled = [], inProgressLegacy = [] } = {}) {
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    let index = 0;
    for (const templateId of completed) {
      await tx.run(`INSERT INTO artworks
        (id,owner_id,source_type,image_url,title,template_id,collection_id,is_completed,created_at,updated_at)
        VALUES (?,?, 'coloring', '/media/x.png', ?, ?, NULL, 1, ?, ?)`,
      [`art_${userId}_${index}`, userId, `${templateId}_${index}`, templateId, NOW, NOW]);
      index += 1;
    }
    for (const templateId of inProgressLegacy) {
      await tx.run(`INSERT INTO coloring_progress
        (user_id,template_id,filled_json,revision,completed_at,created_at,updated_at)
        VALUES (?,?,?,1,NULL,?,?)`,
      [userId, templateId, JSON.stringify(Array(64).fill(0)), NOW, NOW]);
    }
    for (const templateId of inProgressTiled) {
      await tx.run(`INSERT INTO coloring_tiled_progress
        (user_id,template_id,revision,completed_cells,completed_at,created_at,updated_at)
        VALUES (?,?,1,1,NULL,?,?)`,
      [userId, templateId, NOW, NOW]);
    }
  });
}

test('cold start recommendations are deterministic, bounded, and exclude hidden/locked content', async () => {
  const db = await createDb();
  await insertLegacyTemplate(db, 'tpl_free_1', { theme: 'night-city', collectionId: 'col_night-city' });
  await insertLegacyTemplate(db, 'tpl_free_2', { theme: 'space', collectionId: 'col_space' });
  await insertLegacyTemplate(db, 'tpl_hidden', { theme: 'night-city', hidden: true });
  await insertLegacyTemplate(db, 'tpl_gated', { theme: 'night-city' });
  await insertRule(db, 'template', 'tpl_gated', 'level', '5');
  await insertLegacyTemplate(db, 'tpl_premium', { theme: 'space', collectionId: 'col_premium-gallery' });
  await insertLegacyTemplate(db, 'tpl_own', { theme: 'space', ownerId: 'u_cold' });

  const first = await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, (tx) => buildRecommendations(tx, 'u_cold', { limit: 8 }));
  const second = await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, (tx) => buildRecommendations(tx, 'u_cold', { limit: 8 }));
  assert.equal(first.cold_start, true);
  assert.deepEqual(first.recommendations.map((item) => item.id), second.recommendations.map((item) => item.id));
  assert.ok(first.recommendations.length >= 1);
  assert.ok(first.recommendations.every((item) => item.reason_code === 'COLD_START'));
  assert.ok(first.recommendations.every((item) => item.unlock_state !== 'premium_locked' && item.unlock_state !== 'progression_locked'));
  assert.ok(first.recommendations.every((item) => item.id !== 'tpl_hidden'));
  assert.ok(first.recommendations.every((item) => item.id !== 'tpl_own'));
  assert.ok(first.recommendations.every((item) => !Object.hasOwn(item, 'cells') && !Object.hasOwn(item, 'filled')));
});

test('personalized ranking uses verified themes, collections, difficulty, and in-progress state', async () => {
  const db = await createDb();
  await insertLegacyTemplate(db, 'night_1', { theme: 'night-city', collectionId: 'col_night-city' });
  await insertLegacyTemplate(db, 'night_2', { theme: 'night-city', collectionId: 'col_night-city' });
  await insertLegacyTemplate(db, 'night_3', { theme: 'night-city', collectionId: 'col_night-city' });
  await insertLegacyTemplate(db, 'space_1', { theme: 'space', collectionId: 'col_space' });
  await insertLegacyTemplate(db, 'space_2', { theme: 'space', collectionId: 'col_space' });
  await insertTiled(db, 'tiled_1200', { theme: 'night-city', width: 1_200, height: 1_200, difficulty: 'hard' });
  await addHistory(db, 'u_personal', {
    completed: ['night_1', 'night_2'],
    inProgressTiled: ['tiled_1200'],
  });

  const result = await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, (tx) => buildRecommendations(tx, 'u_personal', { limit: 10 }));
  assert.equal(result.cold_start, false);
  const recommendedIds = result.recommendations.map((item) => item.id);
  assert.ok(!recommendedIds.includes('night_1') && !recommendedIds.includes('night_2'), 'completed templates are excluded');
  const tiledItem = result.recommendations.find((item) => item.id === 'tiled_1200');
  assert.ok(tiledItem, 'in-progress tiled template is recommended to continue');
  assert.equal(tiledItem.reason_code, 'CONTINUE_PROGRESS');
  assert.equal(tiledItem.total_cells, 1_200 * 1_200);
  assert.ok(!Object.hasOwn(tiledItem, 'filled'), '1200x1200 recommendation stays bounded');
  const nightItem = result.recommendations.find((item) => item.id === 'night_3');
  assert.equal(nightItem.reason_code, 'THEME_AFFINITY');
  assert.equal(nightItem.signals.theme_count, 3);
});

test('legacy and tiled history for the same template is deduplicated', async () => {
  const db = await createDb();
  await insertLegacyTemplate(db, 'tpl_dual', { theme: 'night-city', collectionId: 'col_night-city' });
  await insertLegacyTemplate(db, 'tpl_other', { theme: 'night-city', collectionId: 'col_night-city' });
  await addHistory(db, 'u_dual', {
    completed: ['tpl_dual'],
    inProgressTiled: ['tpl_dual'],
  });
  const result = await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, (tx) => buildRecommendations(tx, 'u_dual', { limit: 10 }));
  assert.equal(result.cold_start, false);
  assert.equal(result.recommendations.filter((item) => item.id === 'tpl_other').length, 1, 'candidate appears once');
  assert.ok(result.recommendations.every((item) => item.id !== 'tpl_dual'), 'completed+in-progress legacy/tiled row is excluded once');
});

test('recommendations exclude progression and premium locked templates by default', async () => {
  const db = await createDb();
  await insertLegacyTemplate(db, 'tpl_free', { theme: 'night-city' });
  await insertLegacyTemplate(db, 'tpl_locked', { theme: 'night-city' });
  await insertRule(db, 'template', 'tpl_locked', 'level', '99');
  await insertLegacyTemplate(db, 'tpl_premium', { theme: 'night-city', collectionId: 'col_premium-gallery' });
  const result = await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, (tx) => buildRecommendations(tx, 'u_personal', { limit: 10 }));
  const ids = result.recommendations.map((item) => item.id);
  assert.ok(ids.includes('tpl_free'));
  assert.ok(!ids.includes('tpl_locked'));
  assert.ok(!ids.includes('tpl_premium'));
});
