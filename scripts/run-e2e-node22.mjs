import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { assertE2ERuntime } from './assert-e2e-runtime.mjs';
import { buildManifestPlaywrightArgs, buildShardPlan, loadShardManifest } from './e2e-shard-plan.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
assertE2ERuntime(projectRoot);
const playwrightCli = resolve(projectRoot, 'node_modules/@playwright/test/cli.js');
const inputArgs = process.argv.slice(2);
const manifestPath = process.env.E2E_SHARD_MANIFEST;
let playwrightArgs = inputArgs;

if (manifestPath) {
  const shardArgumentIndex = inputArgs.findIndex((value) => value === '--shard' || value.startsWith('--shard='));
  const shardArgument = shardArgumentIndex >= 0
    ? inputArgs[shardArgumentIndex] === '--shard' ? inputArgs[shardArgumentIndex + 1] : inputArgs[shardArgumentIndex].slice('--shard='.length)
    : null;
  if (!shardArgument) throw new Error('E2E_SHARD_MANIFEST requires --shard=N/M');
  const [shardIndex, shardCount] = shardArgument.split('/').map(Number);
  if (!Number.isInteger(shardIndex) || !Number.isInteger(shardCount)) throw new Error(`Invalid --shard value: ${shardArgument}`);
  if (inputArgs.some((value) => value === '--grep' || value.startsWith('--grep=') || value === '--grep-invert' || value.startsWith('--grep-invert='))) {
    throw new Error('E2E_SHARD_MANIFEST owns test selection; do not combine it with --grep or --grep-invert');
  }
  const { value: manifest } = loadShardManifest(projectRoot, manifestPath);
  const plan = buildShardPlan(manifest, shardIndex, shardCount);
  const argsWithoutShard = inputArgs.filter((value, index) => {
    if (index === shardArgumentIndex) return false;
    if (inputArgs[shardArgumentIndex] === '--shard' && index === shardArgumentIndex + 1) return false;
    return true;
  });
  playwrightArgs = [...argsWithoutShard, ...buildManifestPlaywrightArgs(plan)];
  console.log(`E2E weighted shard ${shardIndex}/${shardCount}: ${plan.expectedLogicalTests} logical tests, ${plan.expectedProjectCases} project cases, ${plan.files.length} files, historical ${Math.round(plan.historicalDurationMs / 1000)}s`);
}

const args = ['test', ...playwrightArgs];
const result = spawnSync(process.execPath, [playwrightCli, ...args], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'test',
  },
  windowsHide: true,
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
