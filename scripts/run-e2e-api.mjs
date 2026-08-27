import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const runtimeDir = await mkdtemp(join(tmpdir(), 'splint-e2e-'));
const runtimeDb = join(runtimeDir, 'test.db');
const mediaDir = join(runtimeDir, 'media');
const {
  DATABASE_URL: _DATABASE_URL,
  S3_ENDPOINT: _S3_ENDPOINT,
  S3_BUCKET: _S3_BUCKET,
  S3_ACCESS_KEY_ID: _S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: _S3_SECRET_ACCESS_KEY,
  ...baseEnv
} = process.env;

await mkdir(mediaDir, { recursive: true });

const child = spawn(process.execPath, ['index.js'], {
  cwd: join(projectRoot, 'server'),
  env: {
    ...baseEnv,
    NODE_ENV: 'test',
    PORT: process.env.E2E_API_PORT || process.env.PORT || '3001',
    SQLITE_DB_PATH: runtimeDb,
    MEDIA_STORAGE_ROOT: mediaDir,
    STORAGE_DRIVER: 'local',
    RATE_LIMIT_MAX: '10000',
    RENDER_OUTBOX_ENABLED: 'true',
    RENDER_OUTBOX_POLL_MS: '50',
    ALLOW_DEV_AUTH: 'true',
    SEED_DEMO_DATA: 'true',
    E2E_SEED_HOOKS: 'true',
    GUIDANCE_BACKFILL_AUTO: 'false',
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
