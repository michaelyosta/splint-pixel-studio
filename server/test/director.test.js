import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createFreshSqliteDbAsync, serverDir } from './helpers/database.js';
import { runMigrations } from '../database/migrations.js';
import { withTransaction } from '../database/transaction.js';
import { buildNextBestAction } from '../services/director.js';

const MIGRATIONS_DIR = join(serverDir, 'migrations', 'sqlite');
const NOW = '2026-08-07T10:00:00.000Z';

async function createDb() {
  const db = await createFreshSqliteDbAsync();
  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir: MIGRATIONS_DIR });
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    await tx.run(`INSERT INTO users (id,nickname,role,created_at,updated_at)
      VALUES (?,?, 'user', ?, ?)`, ['u_guide', 'Guide', NOW, NOW]);
    for (const [id, theme, collectionId] of [
      ['tpl_forest', 'forest', null],
      ['tpl_space', 'space', null],
      ['tpl_sea', 'sea', null],
    ]) {
      await tx.run(`INSERT INTO coloring_templates
        (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,original_media_key,source_type,visibility,status,created_at,updated_at,storage_mode,tile_size,theme,collection_id)
        VALUES (?,?,?,?, 'test', 'easy', 8, 8, ?, ?, NULL, NULL, 'catalog', 'public', 'active', ?, ?, 'legacy', 32, ?, ?)`,
      [id, null, id, id, JSON.stringify(['#000000', '#ffffff']), JSON.stringify(Array(64).fill(0)), NOW, NOW, theme, collectionId]);
    }
  });
  return db;
}

async function insertProgress(db, userId, templateId, filled, updatedAt = NOW) {
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    await tx.run(`INSERT INTO coloring_progress
      (user_id,template_id,revision,filled_json,completed_at,updated_at,created_at)
      VALUES (?,?,?,?,NULL,?,?)`,
    [userId, templateId, 1, JSON.stringify(filled), updatedAt, updatedAt]);
  });
}

test('director cold start returns a startable primary action and bounded choices', async () => {
  const db = await createDb();
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const action = await buildNextBestAction(tx, 'u_guide');
    assert.ok(action.primary_action);
    assert.equal(action.primary_action.type, 'start');
    assert.ok(action.primary_action.template_id);
    assert.ok(action.secondary_actions.length >= 1);
    assert.ok(action.choice_window.options.length >= 1);
    assert.ok(action.choice_window.options.every((option) => option.id && option.title));
    assert.ok(Buffer.byteLength(JSON.stringify(action)) < 50_000, 'director payload stays bounded');
  });
});

test('director resumes the most recently committed unfinished artwork first', async () => {
  const db = await createDb();
  const older = Array(64).fill(-1);
  for (let index = 0; index < 48; index += 1) older[index] = 0;
  const newer = Array(64).fill(-1);
  for (let index = 0; index < 20; index += 1) newer[index] = 0;
  await insertProgress(db, 'u_guide', 'tpl_forest', older, '2026-08-07T09:00:00.000Z');
  await insertProgress(db, 'u_guide', 'tpl_space', newer, '2026-08-07T11:00:00.000Z');

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const action = await buildNextBestAction(tx, 'u_guide');
    assert.equal(action.primary_action.type, 'resume');
    assert.equal(action.primary_action.template_id, 'tpl_space');
    assert.equal(action.primary_action.reason, 'CONTINUE_PROGRESS');
    assert.ok(action.primary_action.progress_percent > 0);
    assert.equal(action.primary_action.last_activity_at, '2026-08-07T11:00:00.000Z');
  });
});

test('director ignores open-history timestamps and excludes completed progress', async () => {
  const db = await createDb();
  const completed = Array(64).fill(0);
  const unfinished = Array(64).fill(-1);
  unfinished[0] = 0;
  await insertProgress(db, 'u_guide', 'tpl_forest', completed, '2026-08-07T12:00:00.000Z');
  await insertProgress(db, 'u_guide', 'tpl_space', unfinished, '2026-08-07T09:00:00.000Z');
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    await tx.run(`INSERT INTO user_template_history (user_id,template_id,opened_at) VALUES (?,?,?)`, [
      'u_guide', 'tpl_space', '2026-08-07T13:00:00.000Z',
    ]);
    const action = await buildNextBestAction(tx, 'u_guide');
    assert.equal(action.primary_action.template_id, 'tpl_space');
    assert.equal(action.primary_action.last_activity_at, '2026-08-07T09:00:00.000Z');
  });
});

test('director keeps a one-cell commit resumable when rounded percent is zero', async () => {
  const db = await createDb();
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    await tx.run('UPDATE coloring_templates SET width=1200,height=1200 WHERE id=?', ['tpl_sea']);
  });
  const oneCell = Array(64).fill(-1);
  oneCell[0] = 0;
  await insertProgress(db, 'u_guide', 'tpl_sea', oneCell, '2026-08-07T12:00:00.000Z');
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const action = await buildNextBestAction(tx, 'u_guide');
    assert.equal(action.primary_action.template_id, 'tpl_sea');
    assert.equal(action.primary_action.progress_percent, 0);
  });
});

test('director exclude keeps the current artwork out of the next action', async () => {
  const db = await createDb();
  const filled = Array(64).fill(-1);
  for (let index = 0; index < 20; index += 1) filled[index] = 0;
  await insertProgress(db, 'u_guide', 'tpl_space', filled);

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const action = await buildNextBestAction(tx, 'u_guide', { excludeTemplateId: 'tpl_space' });
    assert.notEqual(action.primary_action.template_id, 'tpl_space');
    assert.ok(action.secondary_actions.every((item) => item.template_id !== 'tpl_space'));
  });
});
