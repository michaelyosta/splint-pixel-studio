import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const projectRoot = resolve(import.meta.dirname, '..');
const webPort = Number(process.env.E2E_WEB_PORT || 5190);
const apiPort = Number(process.env.E2E_API_PORT || 3012);
const reuseExistingServer = process.env.E2E_REUSE_EXISTING === 'true';
const startedProcesses = [];

async function isAvailable(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function waitFor(url, name) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isAvailable(url)) return;
    await delay(100);
  }
  throw new Error(`${name} did not become available at ${url}`);
}

async function startServer({ name, command, args, url, env }) {
  if (await isAvailable(url)) {
    if (reuseExistingServer) return;
    throw new Error(`${name} is already listening at ${url}; set E2E_REUSE_EXISTING=true to use it`);
  }

  const child = spawn(command, args, {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  startedProcesses.push(child);
  await waitFor(url, name);
}

async function stopServer(child) {
  if (child.exitCode !== null || child.killed) return;

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    process.kill(-child.pid, 'SIGTERM');
  }

  await Promise.race([
    new Promise((resolveExit) => child.once('close', resolveExit)),
    delay(5_000),
  ]);
}

export default async function globalSetup() {
  const sharedEnv = {
    ...process.env,
    E2E_WEB_PORT: String(webPort),
    E2E_API_PORT: String(apiPort),
    NODE_ENV: 'test',
    // Keep the browser and the ephemeral API on the same explicit test-auth
    // contract. Individual specs may still override X-User-Id per context.
    VITE_ALLOW_DEV_AUTH: 'true',
    SPECIAL_CELLS_DIAGNOSTICS: 'true',
  };

  try {
    await startServer({
      name: 'Vite E2E server',
      command: process.execPath,
      args: ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
      url: `http://127.0.0.1:${webPort}/`,
      env: sharedEnv,
    });
    await startServer({
      name: 'E2E API server',
      command: process.execPath,
      args: ['scripts/run-e2e-api.mjs'],
      // Node's default listener resolves to the IPv6 localhost interface on
      // Windows. Probe the same localhost name used by the Vite proxy so a
      // healthy API is not misclassified as unavailable via 127.0.0.1.
      url: `http://localhost:${apiPort}/health`,
      env: sharedEnv,
    });
  } catch (error) {
    await Promise.allSettled(startedProcesses.reverse().map(stopServer));
    throw error;
  }

  return async () => {
    // Stop Vite before the API so no in-flight browser requests are proxied
    // into a server that has already been torn down during runner cleanup.
    await Promise.allSettled(startedProcesses.map(stopServer));
  };
}
