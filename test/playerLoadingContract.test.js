import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('cold player load failure exposes retry instead of an endless loader', async () => {
  const hook = await readFile(new URL('../src/hooks/useColoringSession.js', import.meta.url), 'utf8');
  const player = await readFile(new URL('../src/views/PlayerView.jsx', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');

  assert.match(hook, /setOpenError\(error\.message \|\| 'Не удалось открыть раскраску'\)/);
  assert.match(hook, /lastOpenRequestRef\.current/);
  assert.match(hook, /function retryOpenColoring\(\)/);
  assert.match(player, /data-player-load-error="true"/);
  assert.match(player, /onClick=\{onRetryLoad\}/);
  assert.match(player, /В каталог/);
  assert.match(app, /loadError=\{session\.openError\}/);
  assert.match(app, /onRetryLoad=\{session\.retryOpenColoring\}/);
});
