import { initDb, bootstrapSystemData } from './db.js';

await initDb();
await bootstrapSystemData();
console.log('System data bootstrapped successfully.');
