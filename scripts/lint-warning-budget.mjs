import { spawn } from 'node:child_process';

const budget = Number(process.env.LINT_WARNING_BUDGET || 100);
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
// Windows exposes npx as a .cmd shim; spawning it without a shell returns
// EINVAL on some Node versions. The command is repository-local and has no
// user-controlled arguments, so shell mode is safe here.
const child = spawn(command, ['oxlint'], { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
let output = '';
child.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk); });
child.stderr.on('data', (chunk) => { output += chunk; process.stderr.write(chunk); });
child.on('close', (code) => {
  const warnings = (output.match(/warning /g) || []).length;
  if (code !== 0 || warnings > budget) {
    console.error(`Lint warning budget exceeded: ${warnings}/${budget}`);
    process.exit(code || 1);
  }
  console.log(`Lint warning budget: ${warnings}/${budget}`);
});
