import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { databaseFingerprint, fileDigest, postgresConnection, runPostgresTool } from './postgres-backup-common.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const connection = postgresConnection(process.env.DATABASE_URL);
const outputDir = process.env.BACKUP_DIR || join(process.cwd(), 'backups');
await mkdir(outputDir, { recursive: true, mode: 0o700 });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = join(outputDir, `splint-${timestamp}.dump`);
const partial = `${output}.partial`;
try {
  await runPostgresTool(process.env.PG_DUMP_BIN || 'pg_dump', ['--format=custom', '--no-owner', '--no-password', '--file', partial], connection);
  await chmod(partial, 0o600);
  await rename(partial, output);
} catch (error) {
  await rm(partial, { force: true });
  throw error;
}
const digest = await fileDigest(output);
await writeFile(`${output}.sha256`, `${digest}  ${basename(output)}\n`, { mode: 0o600 });
await writeFile(`${output}.metadata.json`, `${JSON.stringify({
  format: 'splint-postgres-backup', version: 1, created_at: new Date().toISOString(),
  source_fingerprint: databaseFingerprint(connection), sha256: digest,
})}\n`, { mode: 0o600 });
console.log(JSON.stringify({ backup: output, sha256: digest }));
