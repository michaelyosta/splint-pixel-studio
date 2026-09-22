import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TELEGRAM_MINI_APP_BOT_URL } from '../src/lib/telegram.js';

test('standalone browser hands authentication back to the production Telegram Mini App', async () => {
  assert.equal(TELEGRAM_MINI_APP_BOT_URL, 'https://t.me/splint_pixel_studio_bot');

  const source = await readFile(new URL('../src/components/BrowserAuthPage.jsx', import.meta.url), 'utf8');
  const clientSource = await readFile(new URL('../src/api/client.js', import.meta.url), 'utf8');
  const authHookSource = await readFile(new URL('../src/hooks/useBrowserAuth.js', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(source, /data-browser-mini-app-launch/);
  assert.match(source, /Открыть в Telegram/);
  assert.doesNotMatch(source, /!isLoading\s*&&\s*<a[\s\S]{0,400}data-browser-mini-app-launch/);
  assert.doesNotMatch(source, /auth\/telegram\/start/);
  assert.doesNotMatch(source, /onLogin/);
  assert.doesNotMatch(clientSource, /auth\/telegram\/start/);
  assert.doesNotMatch(clientSource, /loginUrl/);
  assert.match(clientSource, /platform\.authMode === 'telegram_init_data'/);
  assert.doesNotMatch(clientSource, /platform\.isTelegram\s*\|\|\s*import\.meta\.env\.VITE_ALLOW_DEV_AUTH/);
  assert.match(authHookSource, /platform\.authMode === 'telegram_init_data'/);
  assert.doesNotMatch(authHookSource, /isAuthenticated:\s*platform\.isTelegram\s*\|\|/);
  // The handoff page is a browser-only surface: a Telegram-hosted user whose
  // bridge resolves init params after the first render must keep the shell and
  // its navigation instead of an authentication wall.
  assert.match(appSource, /if \(!canUseApp && browserAuth\.platform\.isBrowser\) \{\s*\r?\n\s*content = <BrowserAuthPage/);
  assert.doesNotMatch(appSource, /if \(!canUseApp\) \{\s*\r?\n\s*content = <BrowserAuthPage/);
  assert.match(appSource, /const showChrome = \(canUseApp \|\| browserAuth\.platform\.isTelegram\)/);
});
