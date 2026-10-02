import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { databaseFingerprint, postgresConnection, runPostgresTool } from '../scripts/postgres-backup-common.mjs';

const restoreScript = fileURLToPath(new URL('../scripts/restore-postgres.mjs', import.meta.url));
const source = 'postgresql://fixture:synthetic%3Apassword@ep-example.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const target = 'postgresql://fixture:other@127.0.0.1:5433/recovery';

test('Neon pooled/direct and different users identify the same source; recovery is distinct', () => {
  const direct = postgresConnection(source);
  const pooled = postgresConnection(source.replace('ep-example.', 'ep-example-pooler.').replace('fixture:', 'other:'));
  assert.equal(databaseFingerprint(direct), databaseFingerprint(pooled));
  assert.notEqual(databaseFingerprint(direct), databaseFingerprint(postgresConnection(target)));
  assert.equal(direct.options.PGSSLMODE, 'require');
  assert.equal(direct.options.PGCHANNELBINDING, 'require');
});

test('invalid or redirecting connection input fails without leaking its value', () => {
  for (const value of ['not-a-uri-secret', `${source}&host=other`, 'postgresql://fixture:password@localhost/host%3Dother']) {
    assert.throws(() => postgresConnection(value), (error) => {
      assert.equal(error.message, 'A supported PostgreSQL connection URL is required');
      assert.equal(error.message.includes(value), false);
      return true;
    });
  }
});

test('client gets an ephemeral password file, no credential URI/password env, and cleanup after failure', async () => {
  let passwordFile;
  const connection = postgresConnection(source);
  await assert.rejects(runPostgresTool('pg_dump', ['--no-password'], connection, {
    environment: { PATH: process.env.PATH, DATABASE_URL: source, PGPASSWORD: 'unrelated-secret', S3_SECRET_ACCESS_KEY: 'unrelated-secret' },
    spawnProcess(_binary, args, options) {
      passwordFile = options.env.PGPASSFILE;
      assert.deepEqual(args, ['--no-password']);
      assert.equal(options.env.DATABASE_URL, undefined);
      assert.equal(options.env.PGPASSWORD, undefined);
      assert.equal(options.env.S3_SECRET_ACCESS_KEY, undefined);
      assert.equal(options.env.PGSSLMODE, 'require');
      assert.equal(options.env.PGDATABASE, 'neondb');
      const child = new EventEmitter();
      readFile(passwordFile, 'utf8').then((contents) => {
        assert.match(contents, /synthetic\\:password\n$/);
        child.emit('close', 1);
      }).catch((error) => child.emit('error', error));
      return child;
    },
  }), /PostgreSQL client failed/);
  await assert.rejects(access(dirname(passwordFile)), { code: 'ENOENT' });
});

async function archiveFixture(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'splint-restore-guard-test-'));
  const backup = join(directory, 'fixture.dump');
  const body = Buffer.from('synthetic archive fixture');
  const digest = createHash('sha256').update(body).digest('hex');
  await writeFile(backup, body);
  await writeFile(`${backup}.sha256`, `${digest}  fixture.dump\n`);
  try { await callback({ backup, digest }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

function restoreFailure(backup, overrides = {}) {
  const env = { ...process.env, CONFIRM_RESTORE: 'YES', RESTORE_DATABASE_URL: target, BACKUP_FILE: backup, PG_RESTORE_BIN: 'nonexistent-pg-restore-must-not-start', ...overrides };
  delete env.SOURCE_DATABASE_URL;
  delete env.DATABASE_URL;
  Object.assign(env, overrides);
  const result = spawnSync(process.execPath, [restoreScript], { env, encoding: 'utf8', windowsHide: true });
  assert.notEqual(result.status, 0);
  return result.stderr;
}

test('restore verifies the archive checksum before starting any database client', async () => {
  await archiveFixture(async ({ backup }) => {
    await writeFile(backup, 'tampered');
    const output = restoreFailure(backup);
    assert.match(output, /PostgreSQL backup checksum mismatch/);
    assert.doesNotMatch(output, /client could not be started/);
  });
});

test('restore refuses source database including a Neon pooled alias', async () => {
  await archiveFixture(async ({ backup, digest }) => {
    await writeFile(`${backup}.metadata.json`, JSON.stringify({ format: 'splint-postgres-backup', version: 1, sha256: digest, source_fingerprint: databaseFingerprint(postgresConnection(source)) }));
    const output = restoreFailure(backup, { RESTORE_DATABASE_URL: source.replace('ep-example.', 'ep-example-pooler.') });
    assert.match(output, /Refusing restore into the source database/);
    assert.doesNotMatch(output, /synthetic|password|postgresql:\/\//);
  });
});

test('legacy checksum archives require source identity and never fall back to live DATABASE_URL as destination', async () => {
  await archiveFixture(async ({ backup }) => {
    assert.match(restoreFailure(backup), /Legacy backup requires SOURCE_DATABASE_URL/);
    assert.match(restoreFailure(backup, { SOURCE_DATABASE_URL: target }), /Refusing restore into the source database/);
    assert.match(restoreFailure(backup, { DATABASE_URL: source, RESTORE_DATABASE_URL: '' }), /RESTORE_DATABASE_URL and BACKUP_FILE are required/);
  });
});
