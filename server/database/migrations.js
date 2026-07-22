import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';

function sha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function parseMigrationName(filename) {
  const match = basename(filename).match(/^(\d+)_(.+)\.sql$/);
  if (!match) return null;
  return { version: match[1], name: match[2], filename: basename(filename) };
}

function stripTransactionWrappers(sql) {
  let content = sql.replace(/^\s*BEGIN\s*;\s*/i, '').trimStart();
  content = content.replace(/\s*COMMIT\s*;?\s*$/i, '').trimEnd();
  return content;
}

async function discoverMigrations(directory) {
  const entries = await readdir(directory);
  const results = [];

  for (const entry of entries) {
    const parsed = parseMigrationName(entry);
    if (!parsed) continue;

    const filePath = join(directory, entry);
    const rawContent = readFileSync(filePath, 'utf8');
    const checksum = sha256(rawContent);
    const cleanContent = stripTransactionWrappers(rawContent);

    results.push({
      version: parsed.version,
      name: parsed.name,
      filename: parsed.filename,
      filePath,
      rawContent,
      content: cleanContent,
      checksum,
    });
  }

  results.sort((a, b) =>
    parseInt(a.version, 10) - parseInt(b.version, 10),
  );

  const seen = new Set();
  for (const m of results) {
    if (seen.has(m.version)) {
      throw new Error(`Duplicate migration versions detected: ${m.version}`);
    }
    seen.add(m.version);
  }

  return results;
}

async function getAppliedMigrations(mode, pool, sqlite) {
  if (mode === 'postgres') {
    try {
      const rows = (await pool.query('SELECT version, name, checksum FROM schema_migrations ORDER BY version')).rows;
      return new Map(rows.map((r) => [r.version, r]));
    } catch {
      return new Map();
    }
  }

  try {
    const stmt = sqlite.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version');
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return new Map(rows.map((r) => [r.version, r]));
  } catch {
    return new Map();
  }
}

async function ensureMigrationsTable(mode, pool, sqlite, persistFn) {
  if (mode === 'postgres') {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    return;
  }

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  if (persistFn) persistFn();
}

function tableExists(sqlite, tableName) {
  try {
    const stmt = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?");
    stmt.bind([tableName]);
    const exists = stmt.step();
    stmt.free();
    return exists;
  } catch {
    return false;
  }
}

function columnExists(sqlite, tableName, columnName) {
  try {
    const stmt = sqlite.prepare(`PRAGMA table_info(${tableName})`);
    let found = false;
    while (stmt.step()) {
      if (stmt.getAsObject().name === columnName) {
        found = true;
        break;
      }
    }
    stmt.free();
    return found;
  } catch {
    return false;
  }
}

function hasSchemaMigrations(sqlite) {
  try {
    const stmt = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'");
    const hasTable = stmt.step();
    stmt.free();
    if (!hasTable) return false;

    const countStmt = sqlite.prepare('SELECT COUNT(*) as cnt FROM schema_migrations');
    if (countStmt.step()) {
      const cnt = countStmt.getAsObject().cnt;
      countStmt.free();
      return cnt > 0;
    }
    countStmt.free();
    return false;
  } catch {
    return false;
  }
}

async function recordLegacyBaseline(sqlite, migrations, persistFn) {
  if (!tableExists(sqlite, 'users')) return;
  if (hasSchemaMigrations(sqlite)) return;

  const now = new Date().toISOString();
  const baselineVersions = new Set();

  if (tableExists(sqlite, 'users') && tableExists(sqlite, 'coloring_templates') && tableExists(sqlite, 'posts')) {
    baselineVersions.add('001');
  }

  if (tableExists(sqlite, 'daily_streaks') && tableExists(sqlite, 'achievements') &&
      columnExists(sqlite, 'coloring_templates', 'mood')) {
    baselineVersions.add('002');
  }

  if (columnExists(sqlite, 'users', 'role')) {
    baselineVersions.add('003');
  }

  if (baselineVersions.size === 0) return;

  for (const migration of migrations) {
    if (baselineVersions.has(migration.version)) {
      sqlite.run(
        `INSERT OR IGNORE INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)`,
        [migration.version, migration.name, migration.checksum, now],
      );
    }
  }

  if (persistFn) persistFn();
}

function splitSqliteStatements(sql) {
  const trimmed = sql.trim();
  if (!trimmed) return [];

  const statements = [];
  let depth = 0;
  let current = '';

  const re = /\b(BEGIN)\b|\b(END)\b|;/gi;
  let lastIdx = 0;
  let match;

  while ((match = re.exec(trimmed)) !== null) {
    const before = trimmed.slice(lastIdx, match.index + match[0].length);
    current += before;
    lastIdx = match.index + match[0].length;

    if (match[1]) {
      depth++;
    } else if (match[2]) {
      depth = Math.max(0, depth - 1);
    } else {
      if (depth === 0) {
        const stmt = current.trim();
        if (stmt) statements.push(stmt);
        current = '';
      }
    }
  }

  const remaining = trimmed.slice(lastIdx);
  current += remaining;
  const final = current.trim();
  if (final) statements.push(final);

  return statements;
}

async function preValidateFinancialData(mode, pool, sqlite) {
  async function doRun(sql, params) {
    if (mode === 'postgres') {
      try {
        return (await pool.query(sql, params)).rows[0];
      } catch (e) {
        if (e.message && e.message.includes('does not exist')) return null;
        throw e;
      }
    }
    try {
      const stmt = sqlite.prepare(sql);
      stmt.bind(params);
      const result = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      return result;
    } catch (e) {
      if (e.message && e.message.includes('no such table')) return { cnt: 0 };
      throw e;
    }
  }

  const badBalance = await doRun('SELECT COUNT(*) as cnt FROM users WHERE stars_balance < 0');
  if (badBalance && badBalance.cnt > 0) {
    throw new Error(
      `Pre-validation failed: found ${badBalance.cnt} users with negative stars_balance. ` +
      `Cannot apply financial constraints migration. Fix data before migrating.`
    );
  }

  const badPriceUser = await doRun('SELECT COUNT(*) as cnt FROM users WHERE price_in_stars < 0');
  if (badPriceUser && badPriceUser.cnt > 0) {
    throw new Error(
      `Pre-validation failed: found ${badPriceUser.cnt} users with negative price_in_stars. ` +
      `Cannot apply financial constraints migration. Fix data before migrating.`
    );
  }

  const badPriceCol = await doRun('SELECT COUNT(*) as cnt FROM collections WHERE price_in_stars < 0');
  if (badPriceCol && badPriceCol.cnt > 0) {
    throw new Error(
      `Pre-validation failed: found ${badPriceCol.cnt} collections with negative price_in_stars. ` +
      `Cannot apply financial constraints migration. Fix data before migrating.`
    );
  }

  const badPriceMsg = await doRun('SELECT COUNT(*) as cnt FROM message_requests WHERE price_in_stars < 0');
  if (badPriceMsg && badPriceMsg.cnt > 0) {
    throw new Error(
      `Pre-validation failed: found ${badPriceMsg.cnt} message_requests with negative price_in_stars. ` +
      `Cannot apply financial constraints migration. Fix data before migrating.`
    );
  }

  const badStatus = await doRun(
    `SELECT COUNT(*) as cnt FROM message_requests WHERE status NOT IN ('created','payment_pending','processing','delivered','answered','rejected','cancelled')`
  );
  if (badStatus && badStatus.cnt > 0) {
    throw new Error(
      `Pre-validation failed: found ${badStatus.cnt} message_requests with unknown status. ` +
      `Cannot apply financial constraints migration. Fix data before migrating.`
    );
  }
}

export async function runMigrations({
  mode,
  pool,
  sqlite,
  persistFn,
  migrationsDir,
}) {
  const migrations = await discoverMigrations(migrationsDir);

  await ensureMigrationsTable(mode, pool, sqlite, persistFn);

  if (mode === 'sqlite') {
    await recordLegacyBaseline(sqlite, migrations, persistFn);
  }

  const appliedMap = await getAppliedMigrations(mode, pool, sqlite);

  let appliedCount = 0;
  let skippedCount = 0;

  for (const migration of migrations) {
    const existing = appliedMap.get(migration.version);

    if (existing) {
      if (existing.checksum !== migration.checksum) {
        throw new Error(
          `Checksum mismatch for applied migration ${migration.version} ` +
          `("${existing.name}").\n` +
          `  Stored:  ${existing.checksum}\n` +
          `  Current: ${migration.checksum}\n` +
          `Applied migration files must not be modified.`,
        );
      }
      skippedCount++;
      continue;
    }

    if (migration.name === 'database_safety') {
      await preValidateFinancialData(mode, pool, sqlite);
    }

    if (mode === 'postgres') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(migration.content);
        await client.query(
          `INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES ($1, $2, $3, NOW())`,
          [migration.version, migration.name, migration.checksum],
        );
        await client.query('COMMIT');
        appliedCount++;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        throw new Error(
          `Migration ${migration.version} ("${migration.name}") failed: ${error.message}`,
        );
      } finally {
        client.release();
      }
    } else {
      try {
        sqlite.run('BEGIN IMMEDIATE');

        if (migration.content.trim()) {
          const stmts = splitSqliteStatements(migration.content);
          for (const stmt of stmts) {
            sqlite.run(stmt);
          }
        }

        sqlite.run(
          `INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)`,
          [migration.version, migration.name, migration.checksum, new Date().toISOString()],
        );

        sqlite.run('COMMIT');
        if (persistFn) persistFn();
        appliedCount++;
      } catch (error) {
        try { sqlite.run('ROLLBACK'); } catch { /* ignore */ }
        throw new Error(
          `Migration ${migration.version} ("${migration.name}") failed: ${error.message}`,
        );
      }
    }
  }

  return { applied: appliedCount, skipped: skippedCount };
}
