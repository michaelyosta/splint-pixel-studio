import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { runMigrations } from '../database/migrations.js';
import {
  HAZARD_GENERATION_VERSION,
  HAZARD_MISS_PENALTY_CELLS,
  HAZARD_REWARD_MAX_CELLS,
  buildHazardMissPenalty,
  buildHazardOffer,
  deriveHazardDisarmChanges,
  generateHazardCells,
  generateLegacyHazardCells,
} from '../services/tiled-hazard.js';
import {
  HAZARD_KIND,
  SPECIAL_MAX_DERIVED_CHANGES,
  generateLegacySparkCells,
  generateSpecialCells,
} from '../services/tiled-specials.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function createSqliteDatabase() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const run = (sql, params = []) => {
    const statement = db.prepare(sql);
    try {
      statement.bind(params);
      statement.step();
    } finally {
      statement.free();
    }
  };
  const all = (sql, params = []) => {
    const rows = [];
    const statement = db.prepare(sql);
    try {
      statement.bind(params);
      while (statement.step()) rows.push(statement.getAsObject());
    } finally {
      statement.free();
    }
    return rows;
  };
  await runMigrations({
    mode: 'sqlite',
    pool: null,
    sqlite: db,
    persistFn: null,
    migrationsDir: join(__dirname, '..', 'migrations', 'sqlite'),
  });
  return { db, run, all };
}

function tiles(width, height, tileSize = 32) {
  const result = [];
  for (let tileY = 0; tileY < Math.ceil(height / tileSize); tileY += 1) {
    for (let tileX = 0; tileX < Math.ceil(width / tileSize); tileX += 1) {
      const tileWidth = Math.min(tileSize, width - tileX * tileSize);
      const tileHeight = Math.min(tileSize, height - tileY * tileSize);
      result.push({
        tile_x: tileX,
        tile_y: tileY,
        cells: Array(tileWidth * tileHeight).fill(0),
      });
    }
  }
  return result;
}

test('migration 025 accepts hazard and still rejects jammer', async () => {
  const { db, run } = await createSqliteDatabase();
  db.run(`
    INSERT INTO coloring_templates
      (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,
       preview_url,original_media_key,source_type,visibility,status,mood,theme,est_minutes,
       collection_id,daily_featured,added_at,created_at,updated_at)
    VALUES ('template-hazard-migration',NULL,'Hazard Migration','Fixture','art','easy',160,160,'[]','[]',NULL,NULL,
      'catalog','public','active','calm','featured',3,NULL,0,
      '2026-08-10T00:00:00.000Z','2026-08-10T00:00:00.000Z','2026-08-10T00:00:00.000Z')`);
  run(
    `INSERT INTO coloring_special_cells
      (template_id,special_id,kind,cell_index,tile_x,tile_y,local_index,generation_version)
     VALUES ('template-hazard-migration','sc_hazard','hazard',1,0,0,1,4)`,
  );
  assert.throws(
    () => run(
      `INSERT INTO coloring_special_cells
        (template_id,special_id,kind,cell_index,tile_x,tile_y,local_index,generation_version)
       VALUES ('template-hazard-migration','sc_jammer','jammer',2,0,0,2,4)`,
    ),
    /CHECK|constraint/i,
  );
});

test('hazard generation is deterministic and disjoint from the shared special mix', () => {
  for (const [width, height] of [[160, 160], [500, 500], [1200, 1200]]) {
    const options = {
      templateId: `template-hazard-${width}`,
      seed: `hazard-seed-${width}`,
      width,
      height,
      tileSize: 32,
      tiles: tiles(width, height),
    };
    const mixed = generateSpecialCells(options);
    const first = generateHazardCells({ ...options, occupiedIndices: mixed.map((cell) => cell.cell_index) });
    const second = generateHazardCells({ ...options, occupiedIndices: mixed.map((cell) => cell.cell_index) });
    assert.deepEqual(first, second);
    assert.equal(first.length, 1);
    assert.equal(first[0].kind, HAZARD_KIND);
    assert.equal(first[0].generation_version, HAZARD_GENERATION_VERSION);
    const allIndices = new Set(mixed.map((cell) => cell.cell_index));
    assert.equal(allIndices.has(first[0].cell_index), false, 'hazard must not reuse a generated special cell');
  }
});

test('hazard generation skips tiles already at the metadata cap instead of hiding a shared marker', () => {
  const options = {
    templateId: 'template-hazard-cap',
    seed: 'hazard-cap-seed',
    width: 32,
    height: 32,
    tileSize: 32,
    tiles: [{ tile_x: 0, tile_y: 0, cells: Array(32 * 32).fill(0) }],
  };
  const fullTile = generateHazardCells({
    ...options,
    occupiedIndices: Array.from({ length: 8 }, (_, index) => index),
  });
  assert.deepEqual(fullTile, [], 'no hazard may be added to a tile with 8 existing metadata records');

  const withRoom = generateHazardCells({
    ...options,
    occupiedIndices: Array.from({ length: 7 }, (_, index) => index),
  });
  assert.equal(withRoom.length, 1);
  assert.equal(withRoom[0].kind, HAZARD_KIND);
  assert.ok(!Array.from({ length: 7 }, (_, index) => index).includes(withRoom[0].cell_index));
});

test('hazard reward derivation is bounded, exact-color, and never deletes progress', () => {
  const width = 20;
  const height = 20;
  const cells = Array(width * height).fill(0);
  cells[5 * width + 5] = 1;
  const filled = Array(width * height).fill(-1);
  const paintedIndex = 7 * width + 7;
  filled[paintedIndex] = 0;

  const changes = deriveHazardDisarmChanges({
    cells,
    filled,
    width,
    height,
    specialIndex: 10 * width + 10,
  });
  assert.ok(changes.length > 0);
  assert.ok(changes.length <= Math.min(HAZARD_REWARD_MAX_CELLS, SPECIAL_MAX_DERIVED_CHANGES));
  assert.equal(changes.some((change) => change.index === paintedIndex), false);
  for (const change of changes) {
    assert.equal(change.color, cells[change.index]);
    assert.equal(filled[change.index], -1);
  }
});

test('hazard offer and missed penalty are bounded and non-destructive', () => {
  const offer = buildHazardOffer({
    specialId: 'hz_abc',
    offerToken: 'a'.repeat(32),
    progressRevision: 3,
    rewardCells: 100,
  });
  assert.equal(offer.kind, HAZARD_KIND);
  assert.equal(offer.reward_cells, HAZARD_REWARD_MAX_CELLS);
  assert.equal(offer.reward_cap, HAZARD_REWARD_MAX_CELLS);
  assert.equal(offer.penalty.progress_deleted, 0);

  const penalty = buildHazardMissPenalty({
    width: 160,
    height: 160,
    specialIndex: 100,
  });
  assert.equal(penalty.missed, true);
  assert.equal(penalty.temporary, true);
  assert.equal(penalty.cells, HAZARD_MISS_PENALTY_CELLS);
  assert.equal(penalty.progress_deleted, 0);
});

test('legacy Hazard generation preserves the 28x28 fixture and stays disjoint', () => {
  const legacy28 = generateLegacyHazardCells({
    templateId: 'template-hazard-legacy-28',
    width: 28,
    height: 28,
    cells: Array(28 * 28).fill(0),
  });
  assert.deepEqual(legacy28, []);

  for (const [width, height] of [[160, 160], [500, 500], [1200, 1200]]) {
    const options = {
      templateId: `template-hazard-legacy-${width}`,
      seed: `hazard-legacy-seed-${width}`,
      width,
      height,
      cells: Array(width * height).fill(0),
    };
    const legacySpecials = generateLegacySparkCells(options);
    const legacy = generateLegacyHazardCells({
      ...options,
      occupiedIndices: legacySpecials.map((cell) => cell.cell_index),
    });
    assert.equal(legacy.length, 1);
    assert.equal(legacy[0].kind, HAZARD_KIND);
    assert.equal(legacySpecials.some((cell) => cell.cell_index === legacy[0].cell_index), false);
  }
});
