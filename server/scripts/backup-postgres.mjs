import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, join } from 'node:path';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const outputDir = process.env.BACKUP_DIR || join(process.cwd(), 'backups');
await mkdir(outputDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = join(outputDir, `splint-${timestamp}.dump`);
await new Promise((resolve, reject) => {
  const child = spawn(process.env.PG_DUMP_BIN || 'pg_dump', ['--format=custom', '--no-owner', '--file', output, process.env.DATABASE_URL], { stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`pg_dump exited with ${code}`)));
});
const digest = createHash('sha256').update(await (await import('node:fs/promises')).readFile(output)).digest('hex');
await writeFile(`${output}.sha256`, `${digest}  ${basename(output)}\n`, 'utf8');
console.log(JSON.stringify({ backup: output, sha256: digest }));
