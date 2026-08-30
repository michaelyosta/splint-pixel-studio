import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

if (!process.versions.node.startsWith('22.')) {
  console.error(`E2E requires Node 22; detected ${process.versions.node}. Invoke this script with the Node 22 executable.`);
  process.exit(2);
}

const projectRoot = resolve(import.meta.dirname, '..');
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
