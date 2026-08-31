import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const expectedNodeVersion = process.env.E2E_NODE_VERSION || '22.23.2';
const expectedNpmVersion = process.env.E2E_NPM_VERSION || '10.9.8';

if (process.versions.node !== expectedNodeVersion) {
  console.error(`E2E requires Node ${expectedNodeVersion}; detected ${process.versions.node}. Invoke this script with the authoritative Node executable.`);
  process.exit(2);
}

const npmCli = resolve(process.execPath, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js');
const npmVersion = spawnSync(process.execPath, [npmCli, '--version'], { encoding: 'utf8' });
if (npmVersion.status !== 0 || npmVersion.stdout.trim() !== expectedNpmVersion) {
  console.error(`E2E requires npm ${expectedNpmVersion}; detected ${(npmVersion.stdout || npmVersion.stderr || '').trim() || 'unknown'}.`);
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
