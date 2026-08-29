import { spawn } from 'node:child_process';

if (process.env.CONFIRM_RESTORE !== 'YES') throw new Error('Set CONFIRM_RESTORE=YES for a destructive restore');
if (!process.env.DATABASE_URL || !process.env.BACKUP_FILE) throw new Error('DATABASE_URL and BACKUP_FILE are required');
await new Promise((resolve, reject) => {
  const child = spawn(process.env.PG_RESTORE_BIN || 'pg_restore', ['--clean', '--if-exists', '--no-owner', '--dbname', process.env.DATABASE_URL, process.env.BACKUP_FILE], { stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`pg_restore exited with ${code}`)));
});
console.log(JSON.stringify({ restored: process.env.BACKUP_FILE }));
