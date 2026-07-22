import { initDb, seedDemoData } from './db.js';

await initDb();
await seedDemoData();
console.log('Demo data seeded successfully.');
