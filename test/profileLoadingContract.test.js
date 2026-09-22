import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('profile failure clears stale public data and exposes retry UI', async () => {
  const hook = await readFile(new URL('../src/hooks/useProfileData.js', import.meta.url), 'utf8');
  const view = await readFile(new URL('../src/views/ProfileView.jsx', import.meta.url), 'utf8');
  assert.match(hook, /if \(userId\) \{\s*setProfile\(null\);\s*setProfileArtworks\(\[\]\);/s);
  assert.match(hook, /setProfileError\(true\)/);
  assert.match(hook, /setProfileLoading\(false\)/);
  assert.match(view, /Не удалось загрузить профиль/);
  assert.match(view, /onClick=\{onRetry\}/);
});
