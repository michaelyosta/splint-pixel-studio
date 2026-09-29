import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectSourceFiles(full));
    else if (/\.(js|jsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function literalTrackedEvents(source) {
  const events = new Set();
  // Covers metaApi.track('...') and the onTrack('...') prop used by views.
  for (const match of source.matchAll(/[Tt]rack\(\s*'([a-z0-9_]+)'/g)) events.add(match[1]);
  return events;
}

// A single unknown event rejects the whole bounded batch with HTTP 400, which
// silently drops telemetry and trips the player "no page errors" gates. Keep
// the client literals and the server allowlist in lockstep.
test('every literal client analytics event is accepted by the server allowlist', async () => {
  const serverSource = await readFile(join(root, 'server', 'routes', 'meta.js'), 'utf8');
  const allowlistBlock = serverSource.match(/ANALYTICS_EVENTS = new Set\(\[([\s\S]*?)\]\)/)?.[1];
  assert.ok(allowlistBlock, 'server allowlist must stay a static ANALYTICS_EVENTS set');
  const allowed = new Set([...allowlistBlock.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]));
  // Progression milestones are the only events validated by pattern instead.
  const allowedDynamic = /^reach_(25|50|75|100)$/;

  const files = await collectSourceFiles(join(root, 'src'));
  assert.ok(files.length > 0, 'client source files must be discoverable');

  const missing = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const event of literalTrackedEvents(source)) {
      if (allowed.has(event) || allowedDynamic.test(event)) continue;
      missing.push(`${event} (${file.slice(root.length + 1)})`);
    }
  }

  assert.deepEqual(
    [...new Set(missing)].sort(),
    [],
    'client events missing from the server allowlist',
  );
});
