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

test('diagnostic overlay also mounts for the server-proven owner without link params', () => {
  const app = readFileSync(resolve(repoRoot, 'src/App.jsx'), 'utf8');
  const mountAt = app.indexOf('return mountViewportDiagnostic();');
  assert.ok(mountAt > 0, 'App must mount the diagnostic overlay');
  const gateAt = app.lastIndexOf('if (!adminAccess) return undefined;', mountAt);
  assert.ok(gateAt > 0 && mountAt - gateAt < 80, 'mount must sit directly behind the admin gate');
  assert.ok(app.indexOf('useEffect', mountAt - 400) > 0, 'mount must live in an effect with cleanup');
});
