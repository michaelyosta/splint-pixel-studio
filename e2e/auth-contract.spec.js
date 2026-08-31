import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';

const BOT_TOKEN = 'e2e-bot-token';

function buildValidTelegramInitData(user) {
  const params = new URLSearchParams({
    query_id: 'AAHdF6iqAAAAAN0X6Ko',
    user: JSON.stringify(user),
    auth_date: String(Math.floor(Date.now() / 1000)),
  });
  const dataCheckString = [...params.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}

test('valid Telegram initData authenticates the Telegram identity and wins over a dev header', async ({ page }) => {
  const initData = buildValidTelegramInitData({ id: 424242, username: 'telegram_contract_user', first_name: 'Telegram' });
  const response = await page.request.get('/api/users/me', {
    headers: {
      'X-Telegram-Init-Data': initData,
      'X-User-Id': 'spoofed-dev-identity',
    },
  });
  expect(response.status()).toBe(200);
  const profile = await response.json();
  expect(profile.id).toBe('tg_424242');
  expect(profile.nickname).toBe('telegram_contract_user');
});

test('missing or invalid Telegram initData is rejected', async ({ page }) => {
  const missing = await page.request.get('/api/users/me');
  expect(missing.status()).toBe(401);

  const invalid = await page.request.get('/api/users/me', {
    headers: {
      'X-Telegram-Init-Data': 'user=%7B%22id%22%3A424242%7D&hash=invalid',
      'X-User-Id': 'spoofed-dev-identity',
    },
  });
  expect(invalid.status()).toBe(401);
});
