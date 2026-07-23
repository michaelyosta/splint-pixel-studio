import { spawn } from 'node:child_process';
import http from 'node:http';

const server = spawn('npm.cmd', ['run', 'dev', '--', '--host', '0.0.0.0'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'pipe',
  shell: true,
});

server.stdout.on('data', (d) => process.stdout.write('[vite] ' + d));
server.stderr.on('data', (d) => process.stderr.write('[vite:err] ' + d));

async function waitForServer(url, retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => { res.resume(); resolve(); });
        req.on('error', reject);
        req.setTimeout(1000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

const ready = await waitForServer('http://localhost:5173');
if (!ready) {
  console.error('Failed to start dev server');
  server.kill();
  process.exit(1);
}

console.log('Dev server ready, running e2e tests...');

import { execSync } from 'node:child_process';
try {
  execSync('npx playwright test', { cwd: new URL('..', import.meta.url).pathname, stdio: 'inherit' });
} catch (e) {
  console.error('E2E tests failed:', e.message);
}

server.kill();
