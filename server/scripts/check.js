import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const routeDirectory = join(root, 'routes');
const routeFiles = (await readdir(routeDirectory)).filter((file) => file.endsWith('.js')).map((file) => join(routeDirectory, file));
const serviceDirectory = join(root, 'services');
const serviceFiles = (await readdir(serviceDirectory)).filter((file) => file.endsWith('.js')).map((file) => join(serviceDirectory, file));
const files = [join(root, 'index.js'), join(root, 'db.js'), join(root, 'seed.js'), join(root, 'middleware', 'auth.js'), ...routeFiles, ...serviceFiles];

for (const file of files) {
  await new Promise((resolve, reject) => {
    const process = spawn('node', ['--check', file], { stdio: 'inherit' });
    process.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Syntax check failed: ${file}`)));
    process.once('error', reject);
  });
}

console.log(`Syntax check passed for ${files.length} server files.`);
