import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('diagnostic overlay mounts only behind the explicit viewport flag', () => {
  const entry = readFileSync(resolve(repoRoot, 'src/main.jsx'), 'utf8');
  assert.match(entry, /shouldMountViewportDiagnostic\(\)/);
  assert.match(entry, /mountViewportDiagnostic\(\)/);
  assert.match(entry, /if \(shouldMountViewportDiagnostic\(\)\)/);
  assert.doesNotMatch(entry, /mountViewportDiagnostic\(\{\s*force/i);
});
