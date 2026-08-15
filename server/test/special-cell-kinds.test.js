import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { runMigrations } from '../database/migrations.js';
import {
  ARTIFACT_KIND,
  BOMB_KIND,
  CHOICE_KIND,
  FUSE_KIND,
  HAZARD_KIND,
  SPECIAL_GAMEPLAY_GENERATION_VERSION,
  SPECIAL_EVENT_MAX_CELLS,
  capSpecialsPerTile,
  SPECIAL_KIND_META,
  SPECIAL_KINDS,
  SPECIAL_MAX_DERIVED_CHANGES,
  SPARK_DENSITY_CELLS,
  SPARK_KIND,
  SPARK_MAX_CELLS,
  generateSparkCells,
  generateSpecialCells,
  getSparkExperimentGroup,
  normalizeSpecialKind,
  persistSparkCells,
  specialDensityForGrid,
} from '../services/tiled-specials.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqliteMigrationsDir = join(__dirname, '..', 'migrations', 'sqlite');
const postgresMigrationsDir = join(__dirname, '..', 'migrations');

function sqliteDatabase() {
  return new Promise((resolve) => {
    initSqlJs().then((SQL) => {
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
      resolve({ db, run, all });
    });
  });
}

function insertTemplate(db, templateId = 'template-special-kinds') {
  db.run(
    `INSERT INTO coloring_templates
      (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,
       preview_url,original_media_key,source_type,visibility,status,mood,theme,est_minutes,
       collection_id,daily_featured,added_at,created_at,updated_at)
     VALUES (?,NULL,'Special Kinds','Fixture','art','easy',160,160,'[]','[]',NULL,NULL,
       'catalog','public','active','calm','featured',3,NULL,0,
       '2026-08-09T00:00:00.000Z','2026-08-09T00:00:00.000Z','2026-08-09T00:00:00.000Z')`,
    [templateId],
  );
}

function insertTemplateUser(db, templateId = 'template-special-kinds') {
  insertTemplate(db, templateId);
  db.run(
    `INSERT INTO users (id,telegram_id,nickname,created_at,updated_at)
     VALUES ('user-special-kinds',1,'Special Kinds','2026-08-09T00:00:00.000Z','2026-08-09T00:00:00.000Z')`,
  );
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

test('migration 024/025 preserve a 023 SQLite database and allow the six special kinds', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'splint-special-kinds-'));
  const legacyDir = join(tmp, 'migrations');
  cpSync(sqliteMigrationsDir, legacyDir, { recursive: true });
  rmSync(join(legacyDir, '024_special_cell_kinds.sql'));
  rmSync(join(legacyDir, '025_special_cell_hazard.sql'));

  const { db, run, all } = await sqliteDatabase();
  run('PRAGMA foreign_keys = ON;');
  const firstPass = await runMigrations({
    mode: 'sqlite',
    pool: null,
    sqlite: db,
    persistFn: null,
    migrationsDir: legacyDir,
  });
  assert.equal(firstPass.applied, 23);
  assert.equal(firstPass.skipped, 0);

  insertTemplateUser(db);
  run(
    `INSERT INTO coloring_special_cells
      (template_id,special_id,kind,cell_index,tile_x,tile_y,local_index,generation_version)
     VALUES ('template-special-kinds','sc_023','spark',0,0,0,0,2)`,
  );
  run(
    `INSERT INTO coloring_special_progress
      (user_id,template_id,special_id,status,offer_revision,offer_token_hash,updated_at)
     VALUES ('user-special-kinds','template-special-kinds','sc_023','offered',1,'hash','2026-08-09T00:00:00.000Z')`,
  );
  assert.throws(
    () => run(
      `INSERT INTO coloring_special_cells
        (template_id,special_id,kind,cell_index,tile_x,tile_y,local_index,generation_version)
       VALUES ('template-special-kinds','sc_bomb_023','bomb',1,0,0,1,3)`,
    ),
    /CHECK|constraint/i,
    '023 keeps the spark-only CHECK constraint',
  );

  const secondPass = await runMigrations({
    mode: 'sqlite',
    pool: null,
    sqlite: db,
    persistFn: null,
    migrationsDir: sqliteMigrationsDir,
  });
  assert.equal(secondPass.applied, 2);
  assert.equal(secondPass.skipped, 23);

  const preserved = all('SELECT * FROM coloring_special_cells WHERE template_id=?', ['template-special-kinds']);
  assert.equal(preserved.length, 1);
  assert.equal(preserved[0].special_id, 'sc_023');
  assert.equal(preserved[0].kind, 'spark');
  const progress = all('SELECT * FROM coloring_special_progress WHERE template_id=?', ['template-special-kinds']);
  assert.equal(progress.length, 1);
  assert.equal(progress[0].status, 'offered');

  SPECIAL_KINDS.forEach((kind, index) => {
    run(
      `INSERT INTO coloring_special_cells
        (template_id,special_id,kind,cell_index,tile_x,tile_y,local_index,generation_version)
       VALUES ('template-special-kinds',?,?,?,0,0,?,3)`,
      [`sc_${kind}`, kind, 10 + index, 10 + index],
    );
  });
  assert.throws(
    () => run(
      `INSERT INTO coloring_special_cells
        (template_id,special_id,kind,cell_index,tile_x,tile_y,local_index,generation_version)
       VALUES ('template-special-kinds','sc_jammer','jammer',99,0,0,99,3)`,
    ),
    /CHECK|constraint/i,
    '025 still rejects unknown special kinds',
  );

  const indexes = all("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_coloring_special_%'");
  const indexNames = indexes.map((row) => row.name);
  assert.ok(indexNames.includes('idx_coloring_special_cells_tile'));
  assert.ok(indexNames.includes('idx_coloring_special_progress_offer'));

  const migrationRows = all("SELECT version FROM schema_migrations WHERE version IN ('024','025')");
  assert.equal(migrationRows.length, 2);

  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

test('migration 024 Postgres SQL relaxes the kind check without rewriting 023', () => {
  const sql = readFileSync(join(postgresMigrationsDir, '024_special_cell_kinds.sql'), 'utf8');
  assert.match(sql, /DROP CONSTRAINT IF EXISTS coloring_special_cells_kind_check/);
  assert.match(sql, /kind IN \('spark', 'bomb', 'fuse', 'choice', 'artifact'\)/);

  const previous = readFileSync(join(postgresMigrationsDir, '023_tiled_special_cells.sql'), 'utf8');
  assert.match(previous, /CHECK \(kind='spark'\)/);
});

test('migration 025 Postgres SQL adds hazard without rewriting 023', () => {
  const sql = readFileSync(join(postgresMigrationsDir, '025_special_cell_hazard.sql'), 'utf8');
  assert.match(sql, /kind IN \('spark', 'bomb', 'fuse', 'choice', 'artifact', 'hazard'\)/);
});

test('persistSparkCells stores every allowed kind in the 025 schema', async () => {
  const { db, run, all } = await sqliteDatabase();
  run('PRAGMA foreign_keys = ON;');
  await runMigrations({
    mode: 'sqlite',
    pool: null,
    sqlite: db,
    persistFn: null,
    migrationsDir: sqliteMigrationsDir,
  });
  insertTemplateUser(db);

  const cells = SPECIAL_KINDS.map((kind, index) => ({
    special_id: `persist_${kind}`,
    kind,
    cell_index: 20 + index,
    tile_x: 0,
    tile_y: 0,
    local_index: 20 + index,
    generation_version: SPECIAL_GAMEPLAY_GENERATION_VERSION,
  }));
  await persistSparkCells({ run }, { templateId: 'template-special-kinds', cells });

  const rows = all('SELECT special_id,kind FROM coloring_special_cells ORDER BY special_id');
  assert.equal(rows.length, SPECIAL_KINDS.length);
  assert.deepEqual(
    rows.map((row) => row.kind).sort(),
    [...SPECIAL_KINDS].sort(),
  );
});

test('generateSpecialCells preserves early Spark placement and Spark density bounds', () => {
  const input = {
    templateId: 'template-mixed-1200',
    width: 1200,
    height: 1200,
    tileSize: 32,
    tiles: tiles(1200, 1200),
  };
  const sparks = generateSparkCells({
    ...input,
    densityCells: specialDensityForGrid(input.width, input.height),
    maxSpecials: SPECIAL_EVENT_MAX_CELLS,
  });
  const mixed = generateSpecialCells(input);

  const boundedSparks = capSpecialsPerTile(sparks);
  assert.equal(mixed.length, boundedSparks.length);
  assert.ok(mixed.length <= SPECIAL_EVENT_MAX_CELLS);
  assert.deepEqual(
    mixed.map((cell) => cell.cell_index),
    boundedSparks.map((cell) => cell.cell_index),
  );
  assert.deepEqual(
    mixed.map((cell) => cell.tile_x),
    boundedSparks.map((cell) => cell.tile_x),
  );
  assert.deepEqual(
    mixed.map((cell) => cell.tile_y),
    boundedSparks.map((cell) => cell.tile_y),
  );
  assert.deepEqual(
    mixed.map((cell) => cell.local_index),
    boundedSparks.map((cell) => cell.local_index),
  );

  assert.equal(mixed[0].kind, SPARK_KIND);
  assert.equal(mixed[0].special_id, boundedSparks[0].special_id);
  assert.equal(mixed[0].cell_index, boundedSparks[0].cell_index);
  const perTile = new Map();
  for (const cell of mixed) {
    const key = `${cell.tile_x}:${cell.tile_y}`;
    perTile.set(key, (perTile.get(key) || 0) + 1);
  }
  assert.ok(Math.max(...perTile.values()) <= 8);
  assert.equal(mixed[0].generation_version, SPECIAL_GAMEPLAY_GENERATION_VERSION);
  for (const cell of mixed) {
    assert.equal(cell.kind_meta, normalizeSpecialKind(cell.kind));
  }
});

test('generateSpecialCells mix is deterministic, seeded, and quota-bounded', () => {
  const input = {
    templateId: 'template-mixed-1200',
    width: 1200,
    height: 1200,
    tileSize: 32,
    tiles: tiles(1200, 1200),
  };
  const first = generateSpecialCells(input);
  const second = generateSpecialCells(input);
  assert.deepEqual(first, second);

  const counts = new Map();
  for (const cell of first.slice(1)) {
    assert.ok(SPECIAL_KINDS.includes(cell.kind), `unexpected kind ${cell.kind}`);
    counts.set(cell.kind, (counts.get(cell.kind) || 0) + 1);
  }
  const sharedKinds = SPECIAL_KINDS.filter((kind) => kind !== HAZARD_KIND && kind !== CHOICE_KIND);
  for (const kind of sharedKinds) {
    assert.ok(counts.has(kind), `large mix does not contain ${kind}`);
  }
  assert.equal(counts.has(HAZARD_KIND), false, 'shared mixed cells do not contain hazard');
  assert.equal(counts.has(CHOICE_KIND), false, 'new production generation omits ceremonial generic Choice');
  const sparkShare = counts.get(SPARK_KIND) / first.length;
  assert.ok(sparkShare >= 0.15 && sparkShare <= 0.2,
    `full-target Spark stays within the 15-20% assisted-progress mix band, got ${sparkShare}`);
  assert.ok(counts.get(BOMB_KIND) > counts.get(SPARK_KIND), 'Bomb carries the calm common-event baseline');
  assert.ok(counts.get(ARTIFACT_KIND) / first.length <= 0.1, 'Artifact stays rare');

  const variants = ['alpha', 'beta', 'gamma', 'delta', 'epsilon']
    .map((seed) => generateSpecialCells({ ...input, seed }).map((cell) => cell.kind).join(','));
  assert.ok(new Set(variants).size >= 2, 'different seeds produce different mixes');
});

test('generateSpecialCells keeps every supported map size within the Spark density contract', () => {
  for (const [width, height, expected] of [[160, 160, 40], [500, 500, 1629], [1200, 1200, 7731]]) {
    const input = {
      templateId: `template-mixed-${width}`,
      seed: `seed-${width}`,
      width,
      height,
      tileSize: 32,
      tiles: tiles(width, height),
    };
    const sparks = generateSparkCells({
      ...input,
      densityCells: specialDensityForGrid(width, height),
      maxSpecials: SPECIAL_EVENT_MAX_CELLS,
    });
    const mixed = generateSpecialCells(input);
    assert.equal(mixed.length, expected);
    assert.equal(mixed.length, capSpecialsPerTile(sparks).length);
    assert.ok(mixed.every((cell) => SPECIAL_KINDS.includes(cell.kind)));
    assert.equal(mixed[0].kind, SPARK_KIND);
  }
});

test('special kind metadata normalizes allowed kinds and rejects unknown kinds', () => {
  for (const kind of SPECIAL_KINDS) {
    const meta = normalizeSpecialKind(kind);
    assert.ok(meta, `${kind} has metadata`);
    assert.equal(meta.kind, kind);
    assert.ok(meta.label, `${kind} has a label`);
    assert.ok(meta.category, `${kind} has a category`);
    assert.equal(normalizeSpecialKind(kind.toUpperCase()), meta);
    assert.equal(Object.isFrozen(meta), true);
  }
  assert.equal(Object.isFrozen(SPECIAL_KIND_META), true);
  assert.equal(normalizeSpecialKind('jammer'), null);
  assert.equal(normalizeSpecialKind(''), null);
  assert.equal(normalizeSpecialKind(null), null);
  assert.equal(normalizeSpecialKind(undefined), null);
});

test('density and effect cap constants remain unchanged and cohort assignment stays deterministic', () => {
  assert.equal(SPARK_DENSITY_CELLS, 6000);
  assert.equal(SPARK_MAX_CELLS, 512);
  assert.equal(SPECIAL_MAX_DERIVED_CHANGES, 32);
  assert.equal(SPECIAL_GAMEPLAY_GENERATION_VERSION, 5);

  const first = getSparkExperimentGroup('user-special-kinds', 'template-special-kinds');
  const second = getSparkExperimentGroup('user-special-kinds', 'template-special-kinds');
  assert.equal(first, second);
  assert.ok(first === 'treatment' || first === 'control');
  assert.equal(SPECIAL_KINDS.length, 6);
  assert.deepEqual(SPECIAL_KINDS, [
    SPARK_KIND,
    BOMB_KIND,
    FUSE_KIND,
    CHOICE_KIND,
    ARTIFACT_KIND,
    HAZARD_KIND,
  ]);
});
