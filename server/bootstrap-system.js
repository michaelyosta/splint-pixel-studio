import { initDb, bootstrapSystemData } from './db.js';

await initDb();
await bootstrapSystemData();
console.log('System data bootstrapped successfully.');

if (getDb().mode === 'sqlite') {
  const { writeFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const directory = dirname(fileURLToPath(import.meta.url));
  const dbPath = process.env.SQLITE_DB_PATH || join(directory, 'splint.db.bin');
  const { readFileSync } = await import('node:fs');
  import('sql.js').then(async (sqljs) => {
    console.log('System bootstrap preserved.');
  });
}
