import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { assertE2ERuntime } from './assert-e2e-runtime.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
assertE2ERuntime(projectRoot);
const playwrightCli = resolve(projectRoot, 'node_modules/@playwright/test/cli.js');
const args = ['test', ...process.argv.slice(2)];
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
