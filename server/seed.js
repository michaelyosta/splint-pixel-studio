import { initDb, resetDemoData } from './db.js';

await initDb();
await resetDemoData();
console.log('Demo data reset successfully.');
