import { readFile } from 'node:fs/promises';
import { databaseFingerprint, fileDigest, postgresConnection, runPostgresTool } from './postgres-backup-common.mjs';

if (process.env.CONFIRM_RESTORE !== 'YES') throw new Error('Set CONFIRM_RESTORE=YES for a destructive restore');
if (!process.env.RESTORE_DATABASE_URL || !process.env.BACKUP_FILE) throw new Error('RESTORE_DATABASE_URL and BACKUP_FILE are required');
const connection = postgresConnection(process.env.RESTORE_DATABASE_URL);
const backup = process.env.BACKUP_FILE;
const expected = (await readFile(`${backup}.sha256`, 'utf8')).trim().split(/\s+/)[0];
const digest = await fileDigest(backup);
if (!/^[a-f0-9]{64}$/i.test(expected) || expected.toLowerCase() !== digest) throw new Error('PostgreSQL backup checksum mismatch');
let sourceFingerprint;
try {
  const metadata = JSON.parse(await readFile(`${backup}.metadata.json`, 'utf8'));
  if (metadata.format !== 'splint-postgres-backup' || metadata.version !== 1 || metadata.sha256 !== digest || !/^[a-f0-9]{64}$/.test(metadata.source_fingerprint)) throw new Error('Invalid PostgreSQL backup metadata');
  sourceFingerprint = metadata.source_fingerprint;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const source = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
  if (!source) throw new Error('Legacy backup requires SOURCE_DATABASE_URL to verify recovery isolation');
  sourceFingerprint = databaseFingerprint(postgresConnection(source));
}
if (sourceFingerprint === databaseFingerprint(connection)) throw new Error('Refusing restore into the source database; choose a separate recovery database');
const source = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
if (source && databaseFingerprint(postgresConnection(source)) === databaseFingerprint(connection)) throw new Error('Refusing restore into the configured source database');
await runPostgresTool(process.env.PG_RESTORE_BIN || 'pg_restore', [
  '--clean', '--if-exists', '--no-owner', '--no-acl', '--no-password', '--single-transaction', '--exit-on-error', '--dbname', connection.database, backup,
], connection);
console.log(JSON.stringify({ restored: process.env.BACKUP_FILE }));
