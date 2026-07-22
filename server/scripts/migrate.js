import { initDb, runMigrations } from './database/migrations.js';
import initSqlJs from 'sql.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const directory = dirname(fileURLToPath(import.meta.url));

if (process.env.DATABASE_URL) {
  await (await import('./scripts/migrate-postgres.js')).default;
} else {
  const SQL = await initSqlJs();
  const dbPath = process.env.SQLITE_DB_PATH || join(directory, 'splint.db.bin');
  const sqlite = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
  sqlite.run('PRAGMA foreign_keys = ON;');

  try {
    const result = await runMigrations({
      mode: 'sqlite',
      pool: null,
      sqlite,
      persistFn: null,
      migrationsDir: join(directory, 'migrations', 'sqlite'),
    });
    console.log(`SQLite migrations: ${result.applied} applied, ${result.skipped} skipped`);
  } finally {
    sqlite.close();
  }
}
