import initSqlJs from 'sql.js';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../database/migrations.js';

const directory = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(directory, '..');
const dbPath = process.env.SQLITE_DB_PATH || join(serverRoot, 'splint.db.bin');

const SQL = await initSqlJs();
const sqlite = existsSync(dbPath)
  ? new SQL.Database(readFileSync(dbPath))
  : new SQL.Database();

sqlite.run('PRAGMA foreign_keys = ON;');

function persist() {
  writeFileSync(dbPath, Buffer.from(sqlite.export()));
}

try {
  const result = await runMigrations({
    mode: 'sqlite',
    pool: null,
    sqlite,
    persistFn: persist,
    migrationsDir: join(serverRoot, 'migrations', 'sqlite'),
  });
  console.log(`SQLite migrations: ${result.applied} applied, ${result.skipped} skipped`);

  if (result.applied > 0 || !existsSync(dbPath)) {
    persist();
  }

  console.log('SQLite migrations complete.');
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exit(1);
} finally {
  sqlite.close();
}
