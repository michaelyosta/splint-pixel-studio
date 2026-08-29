import { readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.MEDIA_STORAGE_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', 'uploads');
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else files.push({ path: full, bytes: (await stat(full)).size });
  }
}
await walk(root);
console.log(JSON.stringify({ root, objects: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), files }, null, 2));
