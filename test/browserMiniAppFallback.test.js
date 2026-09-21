import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TELEGRAM_MINI_APP_BOT_URL } from '../src/lib/telegram.js';

test('standalone browser hands authentication back to the production Telegram Mini App', async () => {
  assert.equal(TELEGRAM_MINI_APP_BOT_URL, 'https://t.me/splint_pixel_studio_bot');

  const source = await readFile(new URL('../src/components/BrowserAuthPage.jsx', import.meta.url), 'utf8');
  assert.match(source, /data-browser-mini-app-launch/);
  assert.match(source, /Открыть в Telegram/);
  assert.doesNotMatch(source, /auth\/telegram\/start/);
  assert.doesNotMatch(source, /onLogin/);
});
