import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const runtimeDir = await mkdtemp(join(tmpdir(), 'splint-e2e-'));
const runtimeDb = join(runtimeDir, 'test.db');
const mediaDir = join(runtimeDir, 'media');

await mkdir(mediaDir, { recursive: true });

const child = spawn(process.execPath, ['--env-file=../.env.local', 'index.js'], {
  cwd: join(projectRoot, 'server'),
  env: {
    ...process.env,
    PORT: process.env.E2E_API_PORT || process.env.PORT || '3001',
    SQLITE_DB_PATH: runtimeDb,
    MEDIA_STORAGE_ROOT: mediaDir,
    STORAGE_DRIVER: 'local',
    RATE_LIMIT_MAX: '1000',
  },
  stdio: 'inherit',
});

let cleaning = false;
async function cleanup(code = 0) {
  if (cleaning) return;
  cleaning = true;
  await rm(runtimeDir, { recursive: true, force: true });
  process.exit(code);
}

child.once('exit', (code) => cleanup(code ?? 1));
process.once('SIGINT', () => child.kill('SIGINT'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
