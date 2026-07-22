import { initDb, resetDemoData } from './db.js';

const args = process.argv.slice(2);

if (process.env.NODE_ENV === 'production') {
  console.error('Destructive reset is not allowed in production');
  process.exit(1);
}

const { mode } = await initDb();

if (mode === 'postgres') {
  if (process.env.ALLOW_DESTRUCTIVE_DB_RESET !== 'true') {
    console.error('ALLOW_DESTRUCTIVE_DB_RESET must be set to "true"');
    console.error(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.error(`Database: PostgreSQL`);
    process.exit(1);
  }
  if (!args.includes('--yes') && !args.includes('-y')) {
    console.error('reset:demo requires explicit --yes flag for PostgreSQL');
    console.error(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.error(`Database: PostgreSQL`);
    process.exit(1);
  }
}

const db = await initDb();
console.log(`Resetting demo data (${db.mode})...`);
await resetDemoData();
console.log('Demo data reset successfully.');
