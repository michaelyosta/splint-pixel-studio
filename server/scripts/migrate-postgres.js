import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required. Copy server/.env.example and start PostgreSQL with docker compose.');
}

const directory = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(directory, '../migrations/001_initial.sql');
const migration = await readFile(migrationPath, 'utf8');
const pool = new Pool({ connectionString: databaseUrl });

try {
  await pool.query(migration);
  console.log('PostgreSQL schema is ready.');
} finally {
  await pool.end();
}
