import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const connectionOptions = {
  sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT',
  sslkey: 'PGSSLKEY', sslcrl: 'PGSSLCRL', sslcrldir: 'PGSSLCRLDIR',
  sslsni: 'PGSSLSNI', channel_binding: 'PGCHANNELBINDING',
  connect_timeout: 'PGCONNECT_TIMEOUT', application_name: 'PGAPPNAME',
  options: 'PGOPTIONS', client_encoding: 'PGCLIENTENCODING',
  target_session_attrs: 'PGTARGETSESSIONATTRS', gssencmode: 'PGGSSENCMODE',
};

export function postgresConnection(value) {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1) || url.hash) throw new Error();
    const result = {
      host: url.hostname.replace(/^\[|\]$/g, ''), port: url.port || '5432',
      database: decodeURIComponent(url.pathname.slice(1)),
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      options: {},
    };
    if (!result.user || /[:=]/.test(result.database) || Object.values(result).some((part) => typeof part === 'string' && /[\r\n\0]/.test(part))) throw new Error();
    for (const [name, option] of url.searchParams) {
      if (!Object.hasOwn(connectionOptions, name) || /[\r\n\0]/.test(option)) throw new Error();
      result.options[connectionOptions[name]] = option;
    }
    return result;
  } catch {
    // URL parser errors include their input. Never propagate a credential URI.
    throw new Error('A supported PostgreSQL connection URL is required');
  }
}

export function databaseFingerprint(connection) {
  // Neon pooled and direct endpoints address the same branch/database.
  const host = connection.host.toLowerCase().replace(/\.$/, '').replace(/-pooler(?=\.[^.]+\.(?:aws|azure)\.neon\.tech$)/, '');
  return createHash('sha256').update(JSON.stringify([host, connection.port, connection.database])).digest('hex');
}

export async function fileDigest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function runPostgresTool(binary, args, connection, { environment = process.env, spawnProcess = spawn } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'splint-pg-client-'));
  const passwordFile = join(directory, 'pgpass');
  const escape = (value) => value.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
  try {
    await chmod(directory, 0o700);
    const fields = [connection.host, connection.port, connection.database, connection.user, connection.password];
    await writeFile(passwordFile, `${fields.map(escape).join(':')}\n`, { mode: 0o600 });
    const childEnv = {};
    for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL', 'TZ']) {
      if (environment[name]) childEnv[name] = environment[name];
    }
    Object.assign(childEnv, connection.options, {
      PGHOST: connection.host, PGPORT: connection.port, PGDATABASE: connection.database,
      PGUSER: connection.user, PGPASSFILE: passwordFile,
    });
    await new Promise((resolve, reject) => {
      const child = spawnProcess(binary, args, { env: childEnv, stdio: 'inherit', windowsHide: true });
      child.once('error', () => reject(new Error('PostgreSQL client could not be started')));
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`PostgreSQL client failed (exit ${code ?? 'unknown'})`)));
    });
  } finally {
    // This path is the unique directory returned by mkdtemp above.
    await rm(directory, { recursive: true, force: true });
  }
}
