import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createFreshSqliteDbAsync, serverDir } from './helpers/database.js';
import { runMigrations } from '../database/migrations.js';
import { insertTiledTemplate } from '../services/tiled-coloring.js';
import {
  buildGuidancePlan,
  GUIDANCE_REASON,
} from '../services/tiled-guidance.js';
import {
  backfillGuidanceIndex,
  countTemplatesMissingGuidanceIndex,
  findTemplatesMissingGuidanceIndex,
} from '../services/tiled-guidance-backfill.js';

const PALETTE = ['#000000', '#ffffff', '#ff00aa', '#00ffff'];

function wrapSqlite(db) {
  return {
    async get(sql, params = []) {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const row = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      return row;
    },
    async all(sql, params = []) {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    async run(sql, params = []) {
      db.run(sql, params);
      return { changes: db.getRowsModified() };
    },
  };
}

async function withTestTransaction(db, callback) {
  db.run('BEGIN IMMEDIATE');
  try {
    const result = await callback(wrapSqlite(db));
    db.run('COMMIT');
    return result;
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}

function tileCells(width, height, color) {
  return Array.from({ length: width * height }, () => color);
}

function mixedTileCells(width, height, colorA, colorB) {
  return Array.from({ length: width * height }, (_, index) => (index % 2 === 0 ? colorA : colorB));
}

async function createBackfillDb() {
  const db = await createFreshSqliteDbAsync();
  await runMigrations({
    mode: 'sqlite',
    pool: null,
    sqlite: db,
    persistFn: null,
    migrationsDir: join(serverDir, 'migrations', 'sqlite'),
  });
  db.run('INSERT INTO users (id, telegram_id, nickname, created_at, updated_at) VALUES (?,?,?,?,?)',
    ['user-backfill', 9922, 'Backfill', '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z']);
  return db;
}

/**
 * Insert a tiled template exactly like a PRE-021 database would hold it:
 * tiles and progress rows, but no static guidance counts and no marker.
 */
async function insertPre021Template(db, { id, tile0 = 0, tile1 = 1 } = {}) {
  const now = '2026-08-07T00:00:00.000Z';
  const tiles = [
    { tile_x: 0, tile_y: 0, width: 32, height: 32, cells: mixedTileCells(32, 32, 0, 1) },
    { tile_x: 1, tile_y: 0, width: 32, height: 32, cells: mixedTileCells(32, 32, 0, 2) },
    { tile_x: 0, tile_y: 1, width: 32, height: 32, cells: tileCells(32, 32, tile0) },
    { tile_x: 1, tile_y: 1, width: 32, height: 32, cells: tileCells(32, 32, tile1) },
  ];
  await insertTiledTemplate(db, {
    id,
    ownerId: 'user-backfill',
    title: `Pre-021 ${id}`,
    description: 'pre-021 fixture',
    width: 64,
    height: 64,
    palette: PALETTE,
    createdAt: now,
    updatedAt: now,
    tileSize: 32,
    tiles,
  });
  // Strip the index the modern create path built → pre-021 data state.
  await db.run('DELETE FROM coloring_template_tile_color_counts WHERE template_id=?', [id]);
  await db.run('DELETE FROM coloring_template_color_counts WHERE template_id=?', [id]);
  await db.run('DELETE FROM coloring_template_guidance_index_meta WHERE template_id=?', [id]);
  return tiles;
}

function templateFromDb(db, id) {
  const row = db.exec(`SELECT * FROM coloring_templates WHERE id='${id}'`);
  const columns = row[0].columns;
  const values = row[0].values[0];
  const record = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
  return {
    id: record.id,
    width: Number(record.width),
    height: Number(record.height),
    palette: JSON.parse(record.palette_json),
    tile_size: Number(record.tile_size),
    updated_at: record.updated_at,
    storage_mode: record.storage_mode,
  };
}

test('backfillGuidanceIndex builds the static index for pre-021 templates', async () => {
  const db = await createBackfillDb();
  await insertPre021Template(db, { id: 'tpl_bf_1' });
  const adapter = wrapSqlite(db);

  const missing = await countTemplatesMissingGuidanceIndex(adapter);
  assert.equal(missing, 1);

  const result = await backfillGuidanceIndex(adapter, { withTransaction: (cb) => withTestTransaction(db, cb) });
  assert.equal(result.processed, 1);
  assert.equal(result.remaining, 0);

  const meta = await adapter.get('SELECT * FROM coloring_template_guidance_index_meta WHERE template_id=?', ['tpl_bf_1']);
  assert.ok(meta, 'completion marker must exist');
  assert.equal(Number(meta.colors), 3, 'three colors appear in the fixture');
  assert.equal(Number(meta.tiles), 4, 'four tiles have counts');

  // Totals must match the actual tile data (two 50/50 mixed tiles: 512 cells
  // of each color; two single-color tiles: 1024 cells each).
  const colorCounts = await adapter.all(
    'SELECT color_index, total_count FROM coloring_template_color_counts WHERE template_id=? ORDER BY color_index',
    ['tpl_bf_1'],
  );
  const totals = Object.fromEntries(colorCounts.map((row) => [Number(row.color_index), Number(row.total_count)]));
  assert.equal(totals[0], 512 + 512 + 1024);
  assert.equal(totals[1], 512 + 1024);
  assert.equal(totals[2], 512);

  const tileColorRows = await adapter.all(
    'SELECT COUNT(*) AS count FROM coloring_template_tile_color_counts WHERE template_id=?',
    ['tpl_bf_1'],
  );
  assert.equal(Number(tileColorRows[0].count), 6);
});

test('backfill is idempotent: a second run processes nothing', async () => {
  const db = await createBackfillDb();
  await insertPre021Template(db, { id: 'tpl_bf_2' });
  const adapter = wrapSqlite(db);
  await backfillGuidanceIndex(adapter, { withTransaction: (cb) => withTestTransaction(db, cb) });
  const again = await backfillGuidanceIndex(adapter, { withTransaction: (cb) => withTestTransaction(db, cb) });
  assert.equal(again.processed, 0);
  assert.equal(again.remaining, 0);
});

test('backfill is restartable: templateLimit leaves the rest for the next run', async () => {
  const db = await createBackfillDb();
  await insertPre021Template(db, { id: 'tpl_bf_3a' });
  await insertPre021Template(db, { id: 'tpl_bf_3b' });
  await insertPre021Template(db, { id: 'tpl_bf_3c' });
  const adapter = wrapSqlite(db);

  const first = await backfillGuidanceIndex(adapter, {
    limit: 10,
    templateLimit: 2,
    withTransaction: (cb) => withTestTransaction(db, cb),
  });
  assert.equal(first.processed, 2);
  assert.equal(first.remaining, 1);

  const second = await backfillGuidanceIndex(adapter, {
    limit: 10,
    templateLimit: 2,
    withTransaction: (cb) => withTestTransaction(db, cb),
  });
  assert.equal(second.processed, 1);
  assert.equal(second.remaining, 0);
});

test('backfill repairs a partial index (interrupted pre-021 lazy build)', async () => {
  const db = await createBackfillDb();
  await insertPre021Template(db, { id: 'tpl_bf_4' });
  const adapter = wrapSqlite(db);

  // Simulate the exact state the old "COUNT(*) > 0" guard produced when a
  // build was interrupted: a single color row, no tile rows, no marker.
  await db.run(
    `INSERT INTO coloring_template_color_counts (template_id,color_index,total_count)
      VALUES ('tpl_bf_4',0,1)`,
  );

  const result = await backfillGuidanceIndex(adapter, { withTransaction: (cb) => withTestTransaction(db, cb) });
  assert.equal(result.processed, 1);

  const colorCounts = await adapter.all(
    'SELECT color_index, total_count FROM coloring_template_color_counts WHERE template_id=? ORDER BY color_index',
    ['tpl_bf_4'],
  );
  assert.equal(colorCounts.length, 3, 'partial row must be replaced by the full index');
  const totals = Object.fromEntries(colorCounts.map((row) => [Number(row.color_index), Number(row.total_count)]));
  assert.equal(totals[0], 2048, 'totals rebuilt from actual tile data');
});

test('planner returns an explicit diagnostic when the index cannot be built (no tiles)', async () => {
  const db = await createBackfillDb();
  const now = '2026-08-07T00:00:00.000Z';
  await insertPre021Template(db, { id: 'tpl_bf_5' });
  await db.run('DELETE FROM coloring_template_tiles WHERE template_id=?', ['tpl_bf_5']);
  const adapter = wrapSqlite(db);
  const template = templateFromDb(db, 'tpl_bf_5');

  await assert.rejects(
    () => buildGuidancePlan({ db: adapter, userId: 'user-backfill', template, reason: GUIDANCE_REASON.INITIAL_TARGET }),
    (error) => error.code === 'GUIDANCE_INDEX_MISSING' && error.status === 503,
  );
});

test('guidance works for a backfilled template with existing progress', async () => {
  const db = await createBackfillDb();
  const tiles = await insertPre021Template(db, { id: 'tpl_bf_6' });
  const adapter = wrapSqlite(db);

  // Existing progress: paint half of tile (0,0) color 1.
  const targetTile = tiles[0];
  let painted = 0;
  const filled = targetTile.cells.map((color) => {
    if (color === 1 && painted < 256) {
      painted += 1;
      return 1;
    }
    return -1;
  });
  await db.run(
    `INSERT INTO coloring_tiled_progress (user_id,template_id,revision,completed_cells,completed_at,created_at,updated_at)
      VALUES ('user-backfill','tpl_bf_6',3,?,NULL,?,?)`,
    [painted, nowFor(), nowFor()],
  );
  await db.run(
    `INSERT INTO coloring_tiled_progress_tiles (user_id,template_id,tile_x,tile_y,width,height,filled_json,completed_cells,created_at,updated_at)
      VALUES ('user-backfill','tpl_bf_6',0,0,32,32,?,?,?,?)`,
    [JSON.stringify(filled), painted, nowFor(), nowFor()],
  );

  await backfillGuidanceIndex(adapter, { withTransaction: (cb) => withTestTransaction(db, cb) });
  const template = templateFromDb(db, 'tpl_bf_6');
  const plan = await buildGuidancePlan({
    db: adapter,
    userId: 'user-backfill',
    template,
    reason: GUIDANCE_REASON.MANUAL_COLOR,
    selectedColor: 1,
  });

  assert.ok(plan.target, 'plan must contain a real actionable target');
  assert.equal(plan.artwork_complete, false);
  assert.equal(plan.selected_color, 1);
  // 1536 color-1 cells in the fixture minus 256 painted.
  assert.equal(plan.global_remaining_for_color, 1536 - 256);
});

function nowFor() {
  return '2026-08-07T00:00:00.000Z';
}
