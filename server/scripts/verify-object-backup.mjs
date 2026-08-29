import { resolve } from 'node:path';
import { readManifest, requireEnv, verifyArchive } from './object-backup-common.mjs';

requireEnv(['OBJECT_BACKUP_DIR'], 'Object backup verification');
const backupDir = resolve(process.env.OBJECT_BACKUP_DIR);
const manifest = await readManifest(backupDir);
const result = await verifyArchive(backupDir, manifest);
console.log(JSON.stringify({ backup_dir: backupDir, ...result }, null, 2));
if (!result.ok) process.exit(1);
