import { resolve } from 'node:path';
import { readManifest, requireEnv, verifyArchive } from './object-backup-common.mjs';

requireEnv(['OBJECT_BACKUP_DIR'], 'Object backup verification');
const backupDir = resolve(process.env.OBJECT_BACKUP_DIR);
const manifest = await readManifest(backupDir);
const result = await verifyArchive(backupDir, manifest);
const failureCounts = {};
for (const failure of result.failures) failureCounts[failure.reason] = (failureCounts[failure.reason] || 0) + 1;
console.log(JSON.stringify({ backup_dir: backupDir, ok: result.ok, object_count: result.object_count, total_bytes: result.total_bytes, failure_count: result.failures.length, failure_reasons: failureCounts }, null, 2));
if (!result.ok) process.exit(1);
