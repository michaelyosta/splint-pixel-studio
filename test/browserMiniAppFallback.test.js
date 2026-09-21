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
  assert.doesNotMatch(source, /auth\/telegram\/start/);
  assert.doesNotMatch(source, /onLogin/);
  assert.doesNotMatch(clientSource, /auth\/telegram\/start/);
  assert.doesNotMatch(clientSource, /loginUrl/);
  assert.match(authHookSource, /platform\.authMode === 'telegram_init_data'/);
  assert.doesNotMatch(authHookSource, /isAuthenticated:\s*platform\.isTelegram\s*\|\|/);
  assert.match(appSource, /if \(!canUseApp\)/);
});
