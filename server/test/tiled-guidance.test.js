import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createFreshSqliteDbAsync, serverDir } from './helpers/database.js';
import { runMigrations } from '../database/migrations.js';
import {
  applyTiledChanges,
  insertTiledTemplate,
  persistTiledChanges,
} from '../services/tiled-coloring.js';
import {
  GUIDANCE_REASON,
  buildGuidancePlan,
  buildStaticGuidanceCounts,
  chooseActionableWindow,
} from '../services/tiled-guidance.js';

const PALETTE = ['#000000', '#ffffff', '#ff00aa'];

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

function tileCells(width, height, color) {
  return Array.from({ length: width * height }, () => color);
}

function mixedTileCells(width, height, colorA, colorB) {
  return Array.from({ length: width * height }, (_, index) => (index % 2 === 0 ? colorA : colorB));
}

async function createGuidanceDb() {
  const db = await createFreshSqliteDbAsync();
  await runMigrations({
    mode: 'sqlite',
    pool: null,
    sqlite: db,
    persistFn: null,
    migrationsDir: join(serverDir, 'migrations', 'sqlite'),
  });
  db.run('INSERT INTO users (id, telegram_id, nickname, created_at, updated_at) VALUES (?,?,?,?,?)',
    ['user-guidance', 9911, 'Guidance', '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z']);
  return db;
}

async function seedTemplate(db, { tile0 = 0, tile1 = 1, tile2 = 0, tile3 = 0 } = {}) {
  const width = 64;
  const height = 64;
  const palette = PALETTE;
  const tiles = [
    { tile_x: 0, tile_y: 0, width: 32, height: 32, cells: tileCells(32, 32, tile0) },
    // Color 1 lives only in tile (1,0) by default; a mixed tile carries both.
    { tile_x: 1, tile_y: 0, width: 32, height: 32, cells: tile1 === 1 ? mixedTileCells(32, 32, 0, 1) : tileCells(32, 32, tile1) },
    { tile_x: 0, tile_y: 1, width: 32, height: 32, cells: tileCells(32, 32, tile2) },
    { tile_x: 1, tile_y: 1, width: 32, height: 32, cells: tileCells(32, 32, tile3) },
  ];
  const now = '2026-08-07T00:00:00.000Z';
  await insertTiledTemplate(db, {
    id: 'tpl-guidance',
    ownerId: 'user-guidance',
    title: 'Guidance fixture',
    description: 'bounded guidance fixture',
    width,
    height,
    palette,
    createdAt: now,
    updatedAt: now,
    tileSize: 32,
    tiles,
  });
  const row = await db.get('SELECT * FROM coloring_templates WHERE id=?', ['tpl-guidance']);
  return {
    id: row.id,
    width: Number(row.width),
    height: Number(row.height),
    palette: JSON.parse(row.palette_json),
    tile_size: Number(row.tile_size),
    updated_at: row.updated_at,
    storage_mode: row.storage_mode,
  };
}

async function paintColor(adapter, template, indices, color, startRevision = 0) {
  let revision = startRevision;
  for (let offset = 0; offset < indices.length; offset += 64) {
    const existing = await adapter.get(
      'SELECT * FROM coloring_tiled_progress WHERE user_id=? AND template_id=?',
      ['user-guidance', template.id],
    );
    const state = await applyTiledChanges(adapter, {
      userId: 'user-guidance',
      template,
      existingProgress: existing,
      changes: indices.slice(offset, offset + 64).map((index) => ({ index, color })),
    });
    const persisted = await persistTiledChanges(adapter, {
      userId: 'user-guidance',
      template,
      existingProgress: existing,
      clientRevision: revision,
      now: '2026-08-07T00:00:00.000Z',
      state,
    });
    revision = persisted.revision;
  }
  return revision;
}

test('buildStaticGuidanceCounts produces compact per-tile and per-color totals', () => {
  const { colorTotals, tileTotals } = buildStaticGuidanceCounts([
    { tile_x: 0, tile_y: 0, cells: [0, 1, 1, 2] },
    { tile_x: 1, tile_y: 0, cells: [1, 1, 0, 1] },
  ], 3);
  assert.equal(colorTotals.get(0), 2);
  assert.equal(colorTotals.get(1), 5);
  assert.equal(colorTotals.get(2), 1);
  assert.equal(tileTotals.get('0:0').get(1), 2);
  assert.equal(tileTotals.get('1:0').get(1), 3);
});

test('chooseActionableWindow returns a small dense window with a matching anchor', () => {
  const width = 32;
  const height = 32;
  const cells = new Uint8Array(width * height);
  const filled = new Int16Array(width * height).fill(-1);
  cells.fill(1);
  const windowTarget = chooseActionableWindow({
    cells,
    filled,
    width,
    height,
    colorIndex: 1,
    offsetX: 32,
    offsetY: 64,
  });
  assert.ok(windowTarget);
  assert.ok(windowTarget.estimated_cells > 0);
  assert.ok(windowTarget.bounds.width <= 12 && windowTarget.bounds.height <= 12);
  assert.ok(windowTarget.anchor_x >= 32 && windowTarget.anchor_x < 64);
  assert.ok(windowTarget.anchor_y >= 64 && windowTarget.anchor_y < 96);
});

test('INITIAL_TARGET: opening a fresh map returns a color, a compact target and revision', async () => {
  const db = await createGuidanceDb();
  const adapter = wrapSqlite(db);
  const template = await seedTemplate(adapter);
  const plan = await buildGuidancePlan({
    db: adapter,
    userId: 'user-guidance',
    template,
    reason: GUIDANCE_REASON.INITIAL_TARGET,
    cameraCenter: { x: 16, y: 16 },
  });
  assert.equal(plan.progress_revision, 0);
  assert.ok(Number.isInteger(plan.selected_color));
  assert.ok(plan.global_remaining_for_color > 0);
  assert.ok(plan.target);
  assert.ok(plan.target.estimated_cells > 0);
  assert.equal('cells' in plan, false);
  assert.equal('filled' in plan, false);
  db.close();
});

test('Spark pity makes the first treatment target contain the deterministic early Spark', async () => {
  const db = await createGuidanceDb();
  const adapter = wrapSqlite(db);
  const template = await seedTemplate(adapter);
  const special = await adapter.get(
    "SELECT * FROM coloring_special_cells WHERE template_id=? AND special_id LIKE 'sc_early_%'",
    [template.id],
  );
  const treatment = await buildGuidancePlan({
    db: adapter,
    userId: 'user-guidance',
    template,
    reason: GUIDANCE_REASON.INITIAL_TARGET,
    cameraCenter: { x: 32, y: 32 },
    sparkTreatment: true,
  });
  assert.equal(treatment.special_pity, true);
  assert.equal(treatment.special_id, special.special_id);
  const specialX = Number(special.cell_index) % template.width;
  const specialY = Math.floor(Number(special.cell_index) / template.width);
  assert.ok(specialX >= treatment.target.bounds.min_x && specialX <= treatment.target.bounds.max_x);
  assert.ok(specialY >= treatment.target.bounds.min_y && specialY <= treatment.target.bounds.max_y);

  const control = await buildGuidancePlan({
    db: adapter,
    userId: 'user-guidance',
    template,
    reason: GUIDANCE_REASON.INITIAL_TARGET,
    cameraCenter: { x: 32, y: 32 },
    sparkTreatment: false,
  });
  assert.equal(control.special_pity, undefined);
  db.close();
});

test('Spark early guarantee survives resume progress until the first event is handled', async () => {
  const db = await createGuidanceDb();
  const adapter = wrapSqlite(db);
  const template = await seedTemplate(adapter);
  const special = await adapter.get(
    "SELECT * FROM coloring_special_cells WHERE template_id=? AND special_id LIKE 'sc_early_%'",
    [template.id],
  );
  const nonSpecialIndex = Number(special.cell_index) === 0 ? 1 : 0;
  await paintColor(adapter, template, [nonSpecialIndex], 0);

  const resumed = await buildGuidancePlan({
    db: adapter,
    userId: 'user-guidance',
    template,
    reason: GUIDANCE_REASON.INITIAL_TARGET,
    cameraCenter: { x: 32, y: 32 },
    sparkTreatment: true,
  });
  assert.equal(resumed.progress_revision, 1);
  assert.equal(resumed.special_pity, true);
  assert.equal(resumed.special_id, special.special_id);
  const specialX = Number(special.cell_index) % template.width;
  const specialY = Math.floor(Number(special.cell_index) / template.width);
  assert.ok(specialX >= resumed.target.bounds.min_x && specialX <= resumed.target.bounds.max_x);
  assert.ok(specialY >= resumed.target.bounds.min_y && specialY <= resumed.target.bounds.max_y);

  await adapter.run(`INSERT INTO coloring_special_progress
    (user_id,template_id,special_id,status,offer_revision,offer_token_hash,updated_at)
    VALUES (?,?,?,?,?,?,?)`,
  ['user-guidance', template.id, special.special_id, 'offered', 1, 'token-hash', '2026-08-07T00:00:01.000Z']);
  await assert.rejects(
    () => buildGuidancePlan({
      db: adapter,
      userId: 'user-guidance',
      template,
      reason: GUIDANCE_REASON.INITIAL_TARGET,
      cameraCenter: { x: 32, y: 32 },
      sparkTreatment: true,
    }),
    (error) => error?.code === 'SPECIAL_ACTIVE_OFFER' && error?.status === 409,
    'an active offer owns the next guidance decision',
  );
  const offeredTargets = await buildGuidancePlan({
    db: adapter,
    userId: 'user-guidance',
    template,
    reason: GUIDANCE_REASON.SPECIAL_TARGETS,
    specialId: special.special_id,
    cameraCenter: { x: 32, y: 32 },
    sparkTreatment: true,
  });
  assert.equal(offeredTargets.reason, GUIDANCE_REASON.SPECIAL_TARGETS);

  await adapter.run(`UPDATE coloring_special_progress
    SET status='consumed', offer_token_hash=NULL, updated_at=?
    WHERE user_id=? AND template_id=? AND special_id=?`,
  ['2026-08-07T00:00:02.000Z', 'user-guidance', template.id, special.special_id]);
  const handled = await buildGuidancePlan({
    db: adapter,
    userId: 'user-guidance',
    template,
    reason: GUIDANCE_REASON.INITIAL_TARGET,
    cameraCenter: { x: 32, y: 32 },
    sparkTreatment: true,
  });
  assert.equal(handled.special_pity, undefined);
  db.close();
});

test('GLOBAL_DISCOVERY and MANUAL_COLOR: color absent from a loaded area is found in another tile', async () => {
  const db = await createGuidanceDb();
  const adapter = wrapSqlite(db);
  const template = await seedTemplate(adapter);
  // The client only has tile (0,0) resident; color 1 is not there at all.
  const plan = await buildGuidancePlan({
    db: adapter,
    userId: 'user-guidance',
    template,
    reason: GUIDANCE_REASON.MANUAL_COLOR,
    selectedColor: 1,
    cameraCenter: { x: 16, y: 16 },
    recentKeys: ['0:0'],
  });
  assert.equal(plan.selected_color, 1);
  assert.equal(plan.reason, GUIDANCE_REASON.MANUAL_COLOR);
  assert.equal(plan.target.tile_x, 1);
  assert.equal(plan.target.tile_y, 0);
  assert.ok(plan.global_remaining_for_color > 0);
  db.close();
});

test('SAME_COLOR_NEXT: after the active tile is done the camera moves to the next tile of the same color', async () => {
  const db = await createGuidanceDb();
  // Color 1 exists in both tile (1,0) and tile (0,1).
  const adapter = wrapSqlite(db);
  const template = await seedTemplate(adapter, { tile0: 0, tile1: 1, tile2: 1, tile3: 0 });
  const colorOneIndices = [];
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const index = y * 64 + (32 + x);
      if (index % 2 === 1) colorOneIndices.push(index);
    }
  }
  await paintColor(adapter, template, colorOneIndices, 1);
  const plan = await buildGuidancePlan({
    db: adapter,
    userId: 'user-guidance',
    template,
    reason: GUIDANCE_REASON.SAME_COLOR_NEXT,
    selectedColor: 1,
    cameraCenter: { x: 48, y: 16 },
    recentKeys: [],
  });
  assert.equal(plan.reason, GUIDANCE_REASON.SAME_COLOR_NEXT);
  assert.equal(plan.selected_color, 1);
  assert.equal(plan.target.tile_x, 0);
  assert.equal(plan.target.tile_y, 1);
  assert.equal(plan.progress_revision, 8);
  db.close();
});

test('TRUE_COLOR_COMPLETION and NEXT_COLOR: zero remaining is global, then a rewarding color is offered', async () => {
  const db = await createGuidanceDb();
  const adapter = wrapSqlite(db);
  const template = await seedTemplate(adapter); // color 1 exists only in tile (1,0)
  const colorOneIndices = [];
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const index = y * 64 + (32 + x);
      if (index % 2 === 1) colorOneIndices.push(index);
    }
  }
  await paintColor(adapter, template, colorOneIndices, 1);
  const plan = await buildGuidancePlan({
    db: adapter,
    userId: 'user-guidance',
    template,
    reason: GUIDANCE_REASON.SAME_COLOR_NEXT,
    selectedColor: 1,
    cameraCenter: { x: 48, y: 16 },
  });
  assert.equal(plan.reason, GUIDANCE_REASON.COLOR_COMPLETE);
  assert.equal(plan.color_complete, true);
  assert.equal(plan.next_color, 0);
  assert.ok(plan.target);
  assert.equal(plan.target.color, 0);
  db.close();
});

test('CACHE_EVICTION: guidance is global and never depends on client cache residency', async () => {
  const db = await createGuidanceDb();
  const adapter = wrapSqlite(db);
  const template = await seedTemplate(adapter);
  const plan = await buildGuidancePlan({
    db: adapter,
    userId: 'user-guidance',
    template,
    reason: GUIDANCE_REASON.INITIAL_TARGET,
    cameraCenter: { x: 16, y: 16 },
  });
  assert.ok(plan.target);
  // No cache was passed at all; the planner only reads the compact index and
  // at most one actual tile, which is the bounded-memory contract.
  const rows = await adapter.all('SELECT COUNT(*) AS count FROM coloring_template_tile_color_counts WHERE template_id=?', [template.id]);
  assert.equal(Number(rows[0].count), 5);
  db.close();
});
