import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { runMigrations } from '../database/migrations.js';
import {
  ensureTiledSpecialCells,
  readTiledTile,
  validateTiledChanges,
} from '../services/tiled-coloring.js';
import {
  HAZARD_KIND,
  SPECIAL_GENERATION_VERSION,
  SPECIAL_GAMEPLAY_GENERATION_VERSION,
  SPARK_DENSITY_CELLS,
  SPARK_PITY_INTERVAL_CELLS,
  SPARK_TARGET_MAX_CELLS,
  SPECIAL_MAX_DERIVED_CHANGES,
  buildLegacySpecialTriggerEffort,
  buildSpecialDiagnostics,
  createOfferToken,
  diagnoseSparkPlacement,
  generateLegacySparkCells,
  generateSpecialCells,
  generateSparkCells,
  getSparkExperimentGroup,
  hasSparkCohortOverride,
  hashOfferToken,
  isSparkTreatmentUser,
  isSpecialTargetEligible,
  isSpecialCellsQaEnvironment,
  isSpecialDiagnosticsEnabled,
  readTileSpecials,
  specialEffortBin,
  summarizeSpecialEffort,
} from '../services/tiled-specials.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('effort bins cover trivial through high-work targets without setting a product threshold', () => {
  const examples = new Map([
    [1, '1'],
    [3, '2-3'],
    [12, '4-12'],
    [50, '33-50'],
    [200, '51-200'],
    [500, '200+'],
  ]);
  for (const [cells, bin] of examples) assert.equal(specialEffortBin(cells), bin);
  assert.equal(isSpecialTargetEligible(1), false, 'one cell is the only hard negative sanity guard');
  assert.equal(isSpecialTargetEligible(3), true);
  const summary = summarizeSpecialEffort([1, 3, 12, 50, 200, 500]);
  assert.deepEqual(summary.bins, {
    1: 1,
    '2-3': 1,
    '4-12': 1,
    '13-32': 0,
    '33-50': 1,
    '51-200': 1,
    '200+': 1,
  });
  assert.deepEqual(
    { min: summary.min, p50: summary.p50, p90: summary.p90, p95: summary.p95, max: summary.max },
    { min: 1, p50: 12, p90: 500, p95: 500, max: 500 },
  );
});

test('legacy trigger effort follows the marker connected target, not disconnected same-color islands', () => {
  const width = 12;
  const height = 12;
  const cells = Array(width * height).fill(1);
  const filled = Array(width * height).fill(-1);
  const markerIndex = 6 * width + 6;
  cells[markerIndex] = 0;
  cells[0] = 0;
  cells[11] = 0;
  cells[11 * width] = 0;
  cells[width * height - 1] = 0;

  const effort = buildLegacySpecialTriggerEffort({ cells, filled, width, height, specialIndex: markerIndex });
  assert.equal(effort.estimated_cells, 1);
  assert.equal(effort.effort_bin, '1');
  assert.equal(effort.eligible, false);

  cells[markerIndex + 1] = 0;
  const connected = buildLegacySpecialTriggerEffort({ cells, filled, width, height, specialIndex: markerIndex });
  assert.equal(connected.estimated_cells, 2);
  assert.equal(connected.eligible, true);
});

async function createDiagnosticsDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  await runMigrations({
    mode: 'sqlite',
    pool: null,
    sqlite: db,
    persistFn: null,
    migrationsDir: join(__dirname, '..', 'migrations', 'sqlite'),
  });
  const run = (sql, params = []) => {
    const statement = db.prepare(sql);
    try {
      statement.bind(params);
      statement.step();
    } finally {
      statement.free();
    }
  };
  const get = (sql, params = []) => {
    const statement = db.prepare(sql);
    try {
      statement.bind(params);
      return statement.step() ? statement.getAsObject() : undefined;
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
  return { db, run, get, all };
}

function insertDiagnosticsCells(db, cells) {
  for (const cell of cells || []) {
    db.run(
      `INSERT INTO coloring_special_cells
        (template_id,special_id,kind,cell_index,tile_x,tile_y,local_index,generation_version)
        VALUES (?,?,?,?,?,?,?,?)`,
      [cell.templateId, cell.special_id, 'spark', cell.cell_index, cell.tile_x, cell.tile_y,
        cell.local_index, cell.generation_version],
    );
  }
}

function insertDiagnosticsProgress(db, { userId, templateId, specialId, status, updatedAt = '2026-08-09T00:00:00.000Z' }) {
  db.run(
    `INSERT INTO coloring_special_progress
      (user_id,template_id,special_id,status,offer_revision,offer_token_hash,updated_at)
      VALUES (?,?,?,?,?,?,?)`,
    [userId, templateId, specialId, status, 1, 'diagnostic-token-hash', updatedAt],
  );
}

test('tile metadata keeps an unseen Hazard discoverable under the bounded cap', async () => {
  const diagnostics = await createDiagnosticsDb();
  for (let index = 0; index < 9; index += 1) {
    diagnostics.run(
      `INSERT INTO coloring_special_cells
        (template_id,special_id,kind,cell_index,tile_x,tile_y,local_index,generation_version)
        VALUES (?,?,?,?,?,?,?,?)`,
      ['hazard-priority-fixture', `special-${index}`, index === 8 ? 'hazard' : 'spark', index,
        0, 0, index, 3],
    );
  }
  const visible = await readTileSpecials(diagnostics, {
    templateId: 'hazard-priority-fixture',
    userId: 'hazard-priority-user',
    tileX: 0,
    tileY: 0,
  });
  assert.equal(visible.length, 8);
  assert.equal(visible[0].kind, 'hazard');
  assert.equal(visible.filter((special) => special.kind === 'hazard').length, 1);
});

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

function insertTemplateTiles(db, { templateId, width, height, tileSize = 32, tiles: inputTiles }) {
  const now = '2026-08-11T00:00:00.000Z';
  for (const tile of inputTiles || []) {
    const tileWidth = Math.min(tileSize, width - tile.tile_x * tileSize);
    const tileHeight = Math.min(tileSize, height - tile.tile_y * tileSize);
    db.run(
      `INSERT INTO coloring_template_tiles
        (template_id,tile_x,tile_y,width,height,cells_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`,
      [templateId, tile.tile_x, tile.tile_y, tileWidth, tileHeight,
        JSON.stringify(tile.cells), now, now],
    );
  }
}

function insertSpecialCellRow(db, { templateId, cell }) {
  db.run(
    `INSERT INTO coloring_special_cells
      (template_id,special_id,kind,cell_index,tile_x,tile_y,local_index,generation_version)
      VALUES (?,?,?,?,?,?,?,?)`,
    [templateId, cell.special_id, cell.kind, cell.cell_index, cell.tile_x, cell.tile_y,
      cell.local_index, cell.generation_version],
  );
}

test('Spark placement is deterministic, sparse, and tile-bounded', () => {
  const input = { templateId: 'template-spark-1', width: 1200, height: 1200, tileSize: 32, tiles: tiles(1200, 1200) };
  const first = generateSparkCells(input);
  const second = generateSparkCells(input);
  assert.deepEqual(first, second);
  assert.equal(first.length, 240);
  assert.equal(new Set(first.map((cell) => cell.cell_index)).size, first.length);
  for (const cell of first) {
    assert.equal(cell.tile_x, Math.floor((cell.cell_index % 1200) / 32));
    assert.equal(cell.tile_y, Math.floor(Math.floor(cell.cell_index / 1200) / 32));
    assert.ok(cell.local_index >= 0 && cell.local_index < 1024);
  }
});

test('Spark density and stratification are bounded across supported map sizes', () => {
  for (const [width, height, expected] of [[160, 160, 5], [500, 500, 42], [1200, 1200, 240]]) {
    const report = diagnoseSparkPlacement({
      templateId: `template-${width}`,
      seed: `seed-${width}`,
      width,
      height,
      tileSize: 32,
      tiles: tiles(width, height),
    });
    assert.equal(report.total_cells, width * height);
    assert.equal(report.spark_count, expected);
    assert.equal(report.density_cells_per_spark, (width * height) / expected);
    assert.ok(report.density_cells_per_spark >= SPARK_DENSITY_CELLS - 1000);
    assert.ok(report.density_cells_per_spark <= SPARK_DENSITY_CELLS + 1000);
    const regionCounts = report.spark_count_by_macro_region.map((entry) => entry.count);
    assert.ok(Math.max(...regionCounts) - Math.min(...regionCounts) <= 1);
    assert.equal(report.smart_engine.early_target_guaranteed, true);
    assert.equal(report.smart_engine.expected_targets_to_first_spark, 1);
    assert.equal(report.smart_engine.worst_case_early_route_without_spark, 0);
  }
});

test('Spark placement changes with seed but is deterministic and color-accounted', () => {
  const input = { width: 1200, height: 1200, tileSize: 32, tiles: tiles(1200, 1200) };
  const first = generateSparkCells({ ...input, templateId: 'template-seed', seed: 'alpha' });
  const second = generateSparkCells({ ...input, templateId: 'template-seed', seed: 'alpha' });
  const other = generateSparkCells({ ...input, templateId: 'template-seed', seed: 'beta' });
  assert.deepEqual(first, second);
  assert.notDeepEqual(first.map((cell) => cell.cell_index), other.map((cell) => cell.cell_index));
  const report = diagnoseSparkPlacement({ ...input, templateId: 'template-seed', seed: 'alpha' });
  assert.equal(Object.values(report.spark_count_by_color).reduce((sum, value) => sum + value, 0), 240);
  assert.ok(report.nearest_neighbor_distance.min > 0);
  assert.ok(report.nearest_neighbor_distance.max >= report.nearest_neighbor_distance.average);
});

test('Special gameplay placement reuses deterministic coordinates and bounded type mix', () => {
  const input = { width: 160, height: 160, tileSize: 32, tiles: tiles(160, 160) };
  const first = generateSpecialCells({ ...input, templateId: 'template-special-mix', seed: 'mix-seed' });
  const second = generateSpecialCells({ ...input, templateId: 'template-special-mix', seed: 'mix-seed' });
  assert.deepEqual(first, second);
  assert.equal(first.length, 40);
  assert.equal(first[0].kind, 'spark', 'early target remains Spark');
  assert.deepEqual(new Set(first.map((cell) => cell.kind)), new Set(['spark', 'bomb', 'fuse', 'artifact']));
  assert.equal(new Set(first.map((cell) => cell.cell_index)).size, first.length);
  assert.ok(first.every((cell) => cell.generation_version === 5));
});

test('Spark offer token is one-way hashed and full target cap stays distinct from other effects', () => {
  const offer = createOfferToken();
  assert.notEqual(offer.token, offer.hash);
  assert.equal(hashOfferToken(offer.token), offer.hash);
  assert.equal(SPECIAL_MAX_DERIVED_CHANGES, 32);
  assert.equal(SPARK_TARGET_MAX_CELLS, 144);
});

test('ordinary tiled batches remain capped at 64 while the internal Spark ceiling is 144', () => {
  const changes = Array.from({ length: 65 }, (_, index) => ({ index, color: 0 }));
  assert.throws(
    () => validateTiledChanges(changes, { width: 64, height: 64, paletteLength: 1 }),
    (error) => error?.code === 'INVALID_TILED_CHANGES' && /between 1 and 64/.test(error.message),
  );
  const internal = validateTiledChanges(changes, {
    width: 64,
    height: 64,
    paletteLength: 1,
    maxChanges: SPARK_TARGET_MAX_CELLS,
  });
  assert.equal(internal.changes.length, 65);
  assert.throws(
    () => validateTiledChanges(Array.from({ length: 145 }, (_, index) => ({ index, color: 0 })), {
      width: 64,
      height: 64,
      paletteLength: 1,
      maxChanges: 999,
    }),
    (error) => error?.code === 'INVALID_TILED_CHANGES' && /between 1 and 144/.test(error.message),
  );
});

test('28x28 legacy treatment fixture has one exact deterministic early Spark', () => {
  const input = {
    templateId: 'fixture-28',
    seed: 'fixture-28',
    width: 28,
    height: 28,
    cells: Array(28 * 28).fill(0),
  };
  const first = generateLegacySparkCells(input);
  const reloaded = generateLegacySparkCells(input);
  assert.deepEqual(reloaded, first);
  assert.equal(first.length, 1);
  assert.deepEqual(first[0], {
    special_id: 'sc_early_5e43c13eb99851e3',
    kind: 'spark',
    cell_index: 435,
    tile_x: 0,
    tile_y: 0,
    local_index: 435,
    generation_version: 2,
  });
  assert.equal(first[0].cell_index % 28, 15);
  assert.equal(Math.floor(first[0].cell_index / 28), 15);
});

test('legacy early Spark follows the legacy player initial rewarding color', () => {
  const cells = Array(28 * 28).fill(0);
  for (const index of [319, 320, 321, 347, 348, 349, 375, 376, 377]) cells[index] = 1;
  const [spark] = generateLegacySparkCells({
    templateId: 'fixture-28-two-colors',
    width: 28,
    height: 28,
    cells,
  });
  assert.equal(cells[spark.cell_index], 1, 'legacy starts with the smallest non-empty color');
});

test('legacy placement supports the full 160x160 compatibility range', () => {
  const sparks = generateLegacySparkCells({
    templateId: 'fixture-legacy-160',
    width: 160,
    height: 160,
    cells: Array(160 * 160).fill(0),
  });
  assert.equal(sparks.length, 43);
  assert.ok(sparks.some((spark) => spark.kind === 'artifact'));
  assert.ok(sparks.every((spark) => spark.cell_index >= 0 && spark.cell_index < 160 * 160));
});

test('manual Spark cohort override accepts canonical and legacy aliases, dev-only', () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    allowDevAuth: process.env.ALLOW_DEV_AUTH,
    cohort: process.env.SPECIAL_CELLS_COHORT,
    qaOverride: process.env.SPECIAL_CELLS_QA_OVERRIDE,
    qaUserId: process.env.SPECIAL_CELLS_QA_USER_ID,
  };
  try {
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_DEV_AUTH = 'true';
    process.env.SPECIAL_CELLS_QA_OVERRIDE = 'true';
    process.env.SPECIAL_CELLS_QA_USER_ID = 'qa-user';
    for (const [alias, expected] of [
      ['SPARK_TREATMENT', 'treatment'],
      ['SPARK_CONTROL', 'control'],
      ['SPECIALS_TREATMENT', 'treatment'],
      ['SPECIALS_CONTROL', 'control'],
      ['spark_treatment', 'treatment'],
      ['specials_control', 'control'],
    ]) {
      process.env.SPECIAL_CELLS_COHORT = alias;
      assert.equal(getSparkExperimentGroup('qa-user', 'any-template'), expected, alias);
      assert.equal(hasSparkCohortOverride(process.env, 'qa-user'), true, `${alias} override flag`);
    }

    process.env.NODE_ENV = 'production';
    const deterministic = getSparkExperimentGroup('fixed-user', 'fixed-template');
    process.env.SPECIAL_CELLS_COHORT = deterministic === 'treatment' ? 'SPECIALS_CONTROL' : 'SPECIALS_TREATMENT';
    assert.equal(getSparkExperimentGroup('fixed-user', 'fixed-template'), deterministic);
    assert.equal(hasSparkCohortOverride(process.env, 'qa-user'), false, 'production never reports an override');
  } finally {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.allowDevAuth === undefined) delete process.env.ALLOW_DEV_AUTH; else process.env.ALLOW_DEV_AUTH = previous.allowDevAuth;
    if (previous.cohort === undefined) delete process.env.SPECIAL_CELLS_COHORT; else process.env.SPECIAL_CELLS_COHORT = previous.cohort;
    if (previous.qaOverride === undefined) delete process.env.SPECIAL_CELLS_QA_OVERRIDE; else process.env.SPECIAL_CELLS_QA_OVERRIDE = previous.qaOverride;
    if (previous.qaUserId === undefined) delete process.env.SPECIAL_CELLS_QA_USER_ID; else process.env.SPECIAL_CELLS_QA_USER_ID = previous.qaUserId;
  }
});

test('manual cohort override is inert without dev auth and for unknown values', () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    allowDevAuth: process.env.ALLOW_DEV_AUTH,
    cohort: process.env.SPECIAL_CELLS_COHORT,
    qaOverride: process.env.SPECIAL_CELLS_QA_OVERRIDE,
    qaUserId: process.env.SPECIAL_CELLS_QA_USER_ID,
  };
  try {
    process.env.NODE_ENV = 'test';
    process.env.SPECIAL_CELLS_COHORT = 'SPECIALS_TREATMENT';
    process.env.SPECIAL_CELLS_QA_OVERRIDE = 'true';
    process.env.SPECIAL_CELLS_QA_USER_ID = 'qa-user';
    delete process.env.ALLOW_DEV_AUTH;
    const deterministic = getSparkExperimentGroup('qa-user', 'template-no-dev-auth');
    process.env.ALLOW_DEV_AUTH = 'false';
    assert.equal(getSparkExperimentGroup('qa-user', 'template-no-dev-auth'), deterministic);
    process.env.ALLOW_DEV_AUTH = 'true';
    assert.equal(getSparkExperimentGroup('qa-user', 'template-no-dev-auth'), 'treatment');
    process.env.SPECIAL_CELLS_COHORT = 'NOT_A_COHORT';
    assert.equal(getSparkExperimentGroup('qa-user', 'template-no-dev-auth'), deterministic);
    delete process.env.SPECIAL_CELLS_QA_OVERRIDE;
    assert.equal(getSparkExperimentGroup('qa-user', 'template-no-dev-auth'), deterministic);
  } finally {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.allowDevAuth === undefined) delete process.env.ALLOW_DEV_AUTH; else process.env.ALLOW_DEV_AUTH = previous.allowDevAuth;
    if (previous.cohort === undefined) delete process.env.SPECIAL_CELLS_COHORT; else process.env.SPECIAL_CELLS_COHORT = previous.cohort;
    if (previous.qaOverride === undefined) delete process.env.SPECIAL_CELLS_QA_OVERRIDE; else process.env.SPECIAL_CELLS_QA_OVERRIDE = previous.qaOverride;
    if (previous.qaUserId === undefined) delete process.env.SPECIAL_CELLS_QA_USER_ID; else process.env.SPECIAL_CELLS_QA_USER_ID = previous.qaUserId;
  }
});

test('manual cohort override is inert for non-allowlisted and unknown users', () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    allowDevAuth: process.env.ALLOW_DEV_AUTH,
    cohort: process.env.SPECIAL_CELLS_COHORT,
    qaOverride: process.env.SPECIAL_CELLS_QA_OVERRIDE,
    qaUserId: process.env.SPECIAL_CELLS_QA_USER_ID,
  };
  try {
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_DEV_AUTH = 'true';
    process.env.SPECIAL_CELLS_QA_OVERRIDE = 'true';
    process.env.SPECIAL_CELLS_QA_USER_ID = 'qa-user,qa-second';
    process.env.SPECIAL_CELLS_COHORT = 'SPECIALS_TREATMENT';

    const deterministic = getSparkExperimentGroup('ordinary-dev-user', 'template-qa-user');
    assert.equal(deterministic, isSparkTreatmentUser('ordinary-dev-user', 'template-qa-user') ? 'treatment' : 'control');
    assert.equal(hasSparkCohortOverride(process.env, 'ordinary-dev-user'), false);
    assert.equal(hasSparkCohortOverride(process.env, null), false);
    assert.equal(getSparkExperimentGroup('qa-user', 'template-qa-user'), 'treatment');
    assert.equal(hasSparkCohortOverride(process.env, 'qa-user'), true);
    assert.equal(getSparkExperimentGroup('qa-second', 'template-qa-user'), 'treatment');
    assert.equal(hasSparkCohortOverride(process.env, 'qa-second'), true);

    process.env.NODE_ENV = 'production';
    assert.equal(getSparkExperimentGroup('qa-user', 'template-qa-user'), isSparkTreatmentUser('qa-user', 'template-qa-user') ? 'treatment' : 'control');
    assert.equal(hasSparkCohortOverride(process.env, 'qa-user'), false);
  } finally {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.allowDevAuth === undefined) delete process.env.ALLOW_DEV_AUTH; else process.env.ALLOW_DEV_AUTH = previous.allowDevAuth;
    if (previous.cohort === undefined) delete process.env.SPECIAL_CELLS_COHORT; else process.env.SPECIAL_CELLS_COHORT = previous.cohort;
    if (previous.qaOverride === undefined) delete process.env.SPECIAL_CELLS_QA_OVERRIDE; else process.env.SPECIAL_CELLS_QA_OVERRIDE = previous.qaOverride;
    if (previous.qaUserId === undefined) delete process.env.SPECIAL_CELLS_QA_USER_ID; else process.env.SPECIAL_CELLS_QA_USER_ID = previous.qaUserId;
  }
});

test('QA override and diagnostics require exact dev/test environment and explicit flags', () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    allowDevAuth: process.env.ALLOW_DEV_AUTH,
    cohort: process.env.SPECIAL_CELLS_COHORT,
    qaOverride: process.env.SPECIAL_CELLS_QA_OVERRIDE,
    qaUserId: process.env.SPECIAL_CELLS_QA_USER_ID,
    diagnostics: process.env.SPECIAL_CELLS_DIAGNOSTICS,
  };
  try {
    process.env.ALLOW_DEV_AUTH = 'true';
    process.env.SPECIAL_CELLS_QA_OVERRIDE = 'true';
    process.env.SPECIAL_CELLS_QA_USER_ID = 'qa-user';
    process.env.SPECIAL_CELLS_COHORT = 'SPECIALS_TREATMENT';
    process.env.SPECIAL_CELLS_DIAGNOSTICS = 'true';

    delete process.env.NODE_ENV;
    assert.equal(isSpecialCellsQaEnvironment(), false);
    assert.equal(isSpecialDiagnosticsEnabled(), false);
    assert.equal(hasSparkCohortOverride(process.env, 'qa-user'), false);

    process.env.NODE_ENV = 'production';
    assert.equal(isSpecialCellsQaEnvironment(), false);
    assert.equal(isSpecialDiagnosticsEnabled(), false);
    assert.equal(hasSparkCohortOverride(process.env, 'qa-user'), false);

    process.env.NODE_ENV = 'development';
    assert.equal(isSpecialCellsQaEnvironment(), true);
    assert.equal(isSpecialDiagnosticsEnabled(), true);
    assert.equal(hasSparkCohortOverride(process.env, 'qa-user'), true);

    process.env.NODE_ENV = 'test';
    assert.equal(isSpecialCellsQaEnvironment(), true);
    assert.equal(isSpecialDiagnosticsEnabled(), true);
    assert.equal(hasSparkCohortOverride(process.env, 'qa-user'), true);
  } finally {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.allowDevAuth === undefined) delete process.env.ALLOW_DEV_AUTH; else process.env.ALLOW_DEV_AUTH = previous.allowDevAuth;
    if (previous.cohort === undefined) delete process.env.SPECIAL_CELLS_COHORT; else process.env.SPECIAL_CELLS_COHORT = previous.cohort;
    if (previous.qaOverride === undefined) delete process.env.SPECIAL_CELLS_QA_OVERRIDE; else process.env.SPECIAL_CELLS_QA_OVERRIDE = previous.qaOverride;
    if (previous.qaUserId === undefined) delete process.env.SPECIAL_CELLS_QA_USER_ID; else process.env.SPECIAL_CELLS_QA_USER_ID = previous.qaUserId;
    if (previous.diagnostics === undefined) delete process.env.SPECIAL_CELLS_DIAGNOSTICS; else process.env.SPECIAL_CELLS_DIAGNOSTICS = previous.diagnostics;
  }
});

test('diagnostics contract is stable and never exposes positions, tokens, or effects', async () => {
  const { db, get, all } = await createDiagnosticsDb();
  const template = { id: 'template-diagnostics-contract', width: 160, height: 160, storage_mode: 'legacy' };
  insertDiagnosticsCells(db, generateSparkCells({
    templateId: template.id,
    width: 160,
    height: 160,
    tileSize: 32,
    tiles: tiles(160, 160),
  }).map((cell) => ({ templateId: template.id, ...cell })));

  const diagnostics = await buildSpecialDiagnostics({ get, all }, {
    userId: 'user-diagnostics-contract',
    template,
    progress: { completed_cells: 0 },
    experimentGroup: 'treatment',
  });
  assert.deepEqual(Object.keys(diagnostics).sort(), [
    'active_special_id',
    'cells_to_next_pity_boundary',
    'cohort',
    'cohort_override',
    'completed',
    'completed_at',
    'completed_cells',
    'counts_by_kind',
    'counts_by_status',
    'generation_version',
    'pity_due',
    'placement_version',
    'recent',
    'special_count',
    'storage_mode',
    'target_effort_contract',
    'target_effort_distribution',
    'template_height',
    'template_id',
    'template_width',
    'total_candidates',
    'total_cells',
  ]);
  assert.equal(diagnostics.cohort, 'treatment');
  assert.equal(diagnostics.cohort_override, false);
  assert.equal(diagnostics.placement_version, diagnostics.generation_version);
  assert.equal(diagnostics.template_id, template.id);
  assert.equal(diagnostics.template_width, 160);
  assert.equal(diagnostics.template_height, 160);
  assert.equal(diagnostics.storage_mode, 'legacy');
  assert.equal(diagnostics.total_candidates, 5);
  assert.equal(diagnostics.total_cells, 25_600);
  assert.equal(diagnostics.completed_cells, 0);
  assert.equal(diagnostics.completed, false);
  assert.equal(diagnostics.completed_at, null);
  assert.deepEqual(diagnostics.recent, []);
  assert.equal(diagnostics.counts_by_kind.spark, 5);
  assert.equal(diagnostics.counts_by_kind.bomb, 0);
  const serialized = JSON.stringify(diagnostics);
  for (const sensitive of ['cell_index', 'tile_x', 'tile_y', 'local_index', 'offer_token', 'target_options', 'applied_changes']) {
    assert.ok(!serialized.includes(sensitive), `diagnostics must not expose ${sensitive}`);
  }
});

test('diagnostics expose recent status history and completion without positions or tokens', async () => {
  const { db, get, all } = await createDiagnosticsDb();
  const template = { id: 'template-diagnostics-recent', width: 160, height: 160, storage_mode: 'legacy' };
  const cells = generateSparkCells({
    templateId: template.id,
    width: 160,
    height: 160,
    tileSize: 32,
    tiles: tiles(160, 160),
  });
  assert.equal(cells.length, 5);
  insertDiagnosticsCells(db, cells.map((cell) => ({ templateId: template.id, ...cell })));
  insertDiagnosticsProgress(db, {
    userId: 'user-diagnostics-recent',
    templateId: template.id,
    specialId: cells[0].special_id,
    status: 'consumed',
    updatedAt: '2026-08-09T01:00:00.000Z',
  });
  insertDiagnosticsProgress(db, {
    userId: 'user-diagnostics-recent',
    templateId: template.id,
    specialId: cells[1].special_id,
    status: 'skipped',
    updatedAt: '2026-08-09T02:00:00.000Z',
  });

  const diagnostics = await buildSpecialDiagnostics({ get, all }, {
    userId: 'user-diagnostics-recent',
    template,
    progress: {
      completed_cells: 25_600,
      completed_at: '2026-08-09T03:00:00.000Z',
    },
    experimentGroup: 'treatment',
  });
  assert.equal(diagnostics.completed_cells, 25_600);
  assert.equal(diagnostics.total_cells, 25_600);
  assert.equal(diagnostics.completed, true);
  assert.equal(diagnostics.completed_at, '2026-08-09T03:00:00.000Z');
  assert.equal(diagnostics.recent.length, 2);
  assert.deepEqual(diagnostics.recent.map((entry) => entry.special_id).sort(), [
    cells[0].special_id,
    cells[1].special_id,
  ].sort());
  assert.deepEqual(
    diagnostics.recent.map((entry) => [entry.kind, entry.status]).sort(),
    [['spark', 'consumed'], ['spark', 'skipped']].sort(),
  );
  const serialized = JSON.stringify(diagnostics);
  for (const sensitive of ['cell_index', 'tile_x', 'tile_y', 'local_index', 'offer_token', 'target_options', 'applied_changes']) {
    assert.ok(!serialized.includes(sensitive), `diagnostics must not expose ${sensitive}`);
  }
});

test('initial 1200x1200 treatment diagnostics expose count, version, unseen status, and early pity', async () => {
  const { db, get, all } = await createDiagnosticsDb();
  const template = { id: 'template-diagnostics-1200', width: 1200, height: 1200 };
  insertDiagnosticsCells(db, generateSparkCells({
    templateId: template.id,
    width: 1200,
    height: 1200,
    tileSize: 32,
    tiles: tiles(1200, 1200),
  }).map((cell) => ({ templateId: template.id, ...cell })));

  const diagnostics = await buildSpecialDiagnostics({ get, all }, {
    userId: 'user-diagnostics-1200',
    template,
    progress: { completed_cells: 0 },
    experimentGroup: 'treatment',
  });
  assert.equal(diagnostics.generation_version, SPECIAL_GENERATION_VERSION);
  assert.equal(diagnostics.special_count, 240);
  assert.deepEqual(diagnostics.counts_by_status, { unseen: 240, offered: 0, consumed: 0, skipped: 0 });
  assert.equal(diagnostics.active_special_id, null);
  assert.equal(diagnostics.pity_due, true);
  assert.equal(diagnostics.cells_to_next_pity_boundary, SPARK_PITY_INTERVAL_CELLS);
});

test('special diagnostics track offered, consumed, skipped, and active special id', async () => {
  const { db, get, all } = await createDiagnosticsDb();
  const template = { id: 'template-diagnostics-lifecycle', width: 160, height: 160 };
  const cells = generateSparkCells({
    templateId: template.id,
    width: 160,
    height: 160,
    tileSize: 32,
    tiles: tiles(160, 160),
  });
  assert.equal(cells.length, 5);
  insertDiagnosticsCells(db, cells.map((cell) => ({ templateId: template.id, ...cell })));
  const [first, second, third] = cells;

  insertDiagnosticsProgress(db, {
    userId: 'user-diagnostics-lifecycle',
    templateId: template.id,
    specialId: first.special_id,
    status: 'offered',
    updatedAt: '2026-08-09T01:00:00.000Z',
  });
  let diagnostics = await buildSpecialDiagnostics({ get, all }, {
    userId: 'user-diagnostics-lifecycle',
    template,
    progress: { completed_cells: 10 },
    experimentGroup: 'treatment',
  });
  assert.equal(diagnostics.active_special_id, first.special_id);
  assert.equal(diagnostics.counts_by_status.offered, 1);
  assert.equal(diagnostics.counts_by_status.unseen, 4);
  assert.equal(diagnostics.pity_due, false);
  assert.equal(diagnostics.cells_to_next_pity_boundary, SPARK_PITY_INTERVAL_CELLS - 10);

  insertDiagnosticsProgress(db, {
    userId: 'user-diagnostics-lifecycle',
    templateId: template.id,
    specialId: second.special_id,
    status: 'consumed',
    updatedAt: '2026-08-09T02:00:00.000Z',
  });
  insertDiagnosticsProgress(db, {
    userId: 'user-diagnostics-lifecycle',
    templateId: template.id,
    specialId: third.special_id,
    status: 'skipped',
    updatedAt: '2026-08-09T03:00:00.000Z',
  });
  diagnostics = await buildSpecialDiagnostics({ get, all }, {
    userId: 'user-diagnostics-lifecycle',
    template,
    progress: { completed_cells: 6000 },
    experimentGroup: 'treatment',
  });
  assert.equal(diagnostics.active_special_id, first.special_id, 'oldest offered remains active');
  assert.deepEqual(diagnostics.counts_by_status, { unseen: 2, offered: 1, consumed: 1, skipped: 1 });
  assert.equal(diagnostics.pity_due, false, 'two prior events move the next interval boundary to 18000');
  assert.equal(diagnostics.cells_to_next_pity_boundary, 12000);

  db.run('DELETE FROM coloring_special_progress WHERE user_id=? AND template_id=? AND special_id=?',
    ['user-diagnostics-lifecycle', template.id, first.special_id]);
  diagnostics = await buildSpecialDiagnostics({ get, all }, {
    userId: 'user-diagnostics-lifecycle',
    template,
    progress: { completed_cells: 18000 },
    experimentGroup: 'treatment',
  });
  assert.equal(diagnostics.pity_due, true);
  assert.equal(diagnostics.cells_to_next_pity_boundary, 0);
});

test('control diagnostics expose no special positions, tokens, or active offers', async () => {
  const { db, get, all } = await createDiagnosticsDb();
  const template = { id: 'template-diagnostics-control', width: 160, height: 160, storage_mode: 'legacy' };
  insertDiagnosticsCells(db, generateSparkCells({
    templateId: template.id,
    width: 160,
    height: 160,
    tileSize: 32,
    tiles: tiles(160, 160),
  }).map((cell) => ({ templateId: template.id, ...cell })));

  const diagnostics = await buildSpecialDiagnostics({ get, all }, {
    userId: 'user-diagnostics-control',
    template,
    progress: { completed_cells: 0 },
    experimentGroup: 'control',
  });
  assert.deepEqual(Object.keys(diagnostics).sort(), [
    'active_special_id',
    'cells_to_next_pity_boundary',
    'cohort',
    'cohort_override',
    'completed',
    'completed_at',
    'completed_cells',
    'counts_by_kind',
    'counts_by_status',
    'generation_version',
    'pity_due',
    'placement_version',
    'recent',
    'special_count',
    'storage_mode',
    'target_effort_contract',
    'target_effort_distribution',
    'template_height',
    'template_id',
    'template_width',
    'total_candidates',
    'total_cells',
  ]);
  assert.equal(diagnostics.cohort, 'control');
  assert.equal(diagnostics.cohort_override, false);
  assert.equal(diagnostics.counts_by_kind.spark, 5);
  assert.equal(diagnostics.special_count, 5);
  assert.equal(diagnostics.counts_by_status.unseen, 5);
  assert.equal(diagnostics.active_special_id, null);
  assert.equal(diagnostics.pity_due, false);
  assert.equal(diagnostics.cells_to_next_pity_boundary, SPARK_PITY_INTERVAL_CELLS);
  assert.equal(diagnostics.target_effort_distribution.trigger_targets.sample_count, 0);
  assert.equal(diagnostics.target_effort_distribution.selected_effect_targets.sample_count, 0);
});

test('readTiledTile is read-only; ensureTiledSpecialCells materializes zero-row tiled templates', async () => {
  const diagnostics = await createDiagnosticsDb();
  const template = {
    id: 'template-no-lazy-write',
    width: 64,
    height: 64,
    tile_size: 32,
    storage_mode: 'tiled',
    palette: ['#101820', '#ffffff'],
  };
  insertTemplateTiles(diagnostics, {
    templateId: template.id,
    width: template.width,
    height: template.height,
    tileSize: 32,
    tiles: tiles(64, 64),
  });

  const before = await readTiledTile(diagnostics, {
    template,
    userId: 'user-no-lazy-write',
    tileX: 0,
    tileY: 0,
  });
  assert.deepEqual(before.specials, []);
  assert.equal(
    diagnostics.get(
      'SELECT COUNT(*) AS count FROM coloring_special_cells WHERE template_id=?',
      [template.id],
    ).count,
    0,
    'tile read must not lazily persist special rows',
  );

  const ensured = await ensureTiledSpecialCells(diagnostics, template);
  assert.equal(ensured.action, 'built');
  assert.ok(ensured.special_count > 0);
  assert.equal(ensured.generation_version, SPECIAL_GAMEPLAY_GENERATION_VERSION);

  const after = await readTiledTile(diagnostics, {
    template,
    userId: 'user-no-lazy-write',
    tileX: 0,
    tileY: 0,
  });
  assert.ok(after.specials.length > 0);
});

test('ensureTiledSpecialCells preserves existing v3 rows with progress and backfills exactly one deterministic hazard', async () => {
  const diagnostics = await createDiagnosticsDb();
  const template = {
    id: 'template-v3-progress',
    width: 64,
    height: 64,
    tile_size: 32,
    storage_mode: 'tiled',
    palette: ['#101820', '#ffffff'],
  };
  const inputTiles = tiles(64, 64);
  insertTemplateTiles(diagnostics, {
    templateId: template.id,
    width: template.width,
    height: template.height,
    tileSize: 32,
    tiles: inputTiles,
  });
  const generated = generateSpecialCells({
    templateId: template.id,
    width: template.width,
    height: template.height,
    tileSize: 32,
    tiles: inputTiles,
  });
  assert.ok(generated.length > 0);
  for (const cell of generated) {
    insertSpecialCellRow(diagnostics, {
      templateId: template.id,
      cell: { ...cell, generation_version: SPECIAL_GAMEPLAY_GENERATION_VERSION },
    });
  }
  insertDiagnosticsProgress(diagnostics, {
    userId: 'user-v3-progress',
    templateId: template.id,
    specialId: generated[0].special_id,
    status: 'consumed',
  });

  const before = diagnostics.all(
    `SELECT special_id,kind,cell_index,tile_x,tile_y,local_index,generation_version
       FROM coloring_special_cells WHERE template_id=? ORDER BY cell_index`,
    [template.id],
  );
  const ensured = await ensureTiledSpecialCells(diagnostics, template);
  assert.equal(ensured.action, 'hazard_backfilled');
  assert.equal(ensured.hazard_added, 1);

  const after = diagnostics.all(
    `SELECT special_id,kind,cell_index,tile_x,tile_y,local_index,generation_version
       FROM coloring_special_cells WHERE template_id=? ORDER BY cell_index`,
    [template.id],
  );
  assert.equal(after.length, before.length + 1);
  assert.deepEqual(after.filter((row) => row.kind !== HAZARD_KIND), before);
  assert.equal(after.filter((row) => row.kind === HAZARD_KIND).length, 1);
  assert.equal(
    diagnostics.get(
      `SELECT status FROM coloring_special_progress
        WHERE user_id=? AND template_id=? AND special_id=?`,
      ['user-v3-progress', template.id, generated[0].special_id],
    ).status,
    'consumed',
  );

  const perTile = new Map();
  for (const row of after) {
    const key = `${row.tile_x}:${row.tile_y}`;
    perTile.set(key, (perTile.get(key) || 0) + 1);
  }
  assert.ok(Math.max(...perTile.values()) <= 8, 'hazard backfill must not exceed tile metadata cap');

  await ensureTiledSpecialCells(diagnostics, template);
  const repeated = diagnostics.all(
    'SELECT COUNT(*) AS count FROM coloring_special_cells WHERE template_id=?',
    [template.id],
  );
  assert.equal(repeated[0].count, after.length);

  await Promise.all([
    ensureTiledSpecialCells(diagnostics, template),
    ensureTiledSpecialCells(diagnostics, template),
  ]);
  const concurrent = diagnostics.all(
    'SELECT COUNT(*) AS count FROM coloring_special_cells WHERE template_id=?',
    [template.id],
  );
  assert.equal(concurrent[0].count, after.length);
});

test('ensureTiledSpecialCells builds deterministic shared and hazard rows for zero-row tiled templates', async () => {
  const diagnostics = await createDiagnosticsDb();
  const template = {
    id: 'template-zero-rows',
    width: 64,
    height: 64,
    tile_size: 32,
    storage_mode: 'tiled',
    palette: ['#101820', '#ffffff'],
  };
  insertTemplateTiles(diagnostics, {
    templateId: template.id,
    width: template.width,
    height: template.height,
    tileSize: 32,
    tiles: tiles(64, 64),
  });

  const first = await ensureTiledSpecialCells(diagnostics, template);
  const second = await ensureTiledSpecialCells(diagnostics, template);
  assert.equal(first.action, 'built');
  assert.equal(second.action, 'ready');
  assert.equal(first.special_count, second.special_count);
  const rows = diagnostics.all(
    `SELECT special_id,kind,cell_index FROM coloring_special_cells
      WHERE template_id=? ORDER BY cell_index`,
    [template.id],
  );
  assert.ok(rows.length > 0);
  assert.equal(rows[0].kind, 'spark');
  assert.equal(rows.filter((row) => row.kind === HAZARD_KIND).length, 1);
});
