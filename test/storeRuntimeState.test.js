import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Store receives real collection loading and error state', async () => {
  const home = await readFile(new URL('../src/hooks/useHomeData.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(home, /collectionsLoading/);
  assert.match(home, /setCollectionsError\(true\)/);
  assert.match(app, /loading=\{home\.collectionsLoading\}/);
  assert.match(app, /error=\{home\.collectionsError\}/);
  assert.match(app, /if \(!canUseApp\) \{\s*setPaymentsMode\('disabled'\)/s);
  assert.match(app, /\}, \[canUseApp\]\);/);
});
