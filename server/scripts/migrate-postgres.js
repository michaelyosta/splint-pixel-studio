import pg from 'pg';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './database/migrations.js';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required for PostgreSQL migrations.');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
const directory = dirname(fileURLToPath(import.meta.url));

try {
  const result = await runMigrations({
    mode: 'postgres',
    pool,
    sqlite: null,
    persistFn: null,
    migrationsDir: join(directory, 'migrations'),
  });
  console.log(`PostgreSQL migrations: ${result.applied} applied, ${result.skipped} skipped`);
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exit(1);
} finally {
  await pool.end();
}
