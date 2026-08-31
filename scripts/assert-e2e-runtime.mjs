import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';

const expectedNodeVersion = process.env.E2E_NODE_VERSION || '22.23.2';
const expectedNpmVersion = process.env.E2E_NPM_VERSION || '10.9.8';

function resolveNpmCli(projectRoot) {
  const configured = process.env.npm_execpath
    ? (isAbsolute(process.env.npm_execpath)
      ? process.env.npm_execpath
      : resolve(projectRoot, process.env.npm_execpath))
    : null;
  const candidates = [
    configured,
    resolve(process.execPath, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(process.execPath, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

export function assertE2ERuntime(projectRoot = resolve(import.meta.dirname, '..')) {
  if (process.versions.node !== expectedNodeVersion) {
    console.error(`E2E requires Node ${expectedNodeVersion}; detected ${process.versions.node}. Invoke this script with the authoritative Node executable.`);
    process.exit(2);
  }

  const npmCli = resolveNpmCli(projectRoot);
  const npmVersion = npmCli
    ? spawnSync(process.execPath, [npmCli, '--version'], { encoding: 'utf8' })
    : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], { encoding: 'utf8' });
  const detected = (npmVersion.stdout || npmVersion.stderr || '').trim() || 'unknown';
  if (npmVersion.status !== 0 || npmVersion.stdout.trim() !== expectedNpmVersion) {
    console.error(`E2E requires npm ${expectedNpmVersion}; detected ${detected}. Checked ${npmCli || 'PATH npm'}.`);
    process.exit(2);
  }
}
