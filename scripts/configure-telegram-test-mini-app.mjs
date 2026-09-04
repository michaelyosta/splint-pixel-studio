#!/usr/bin/env node

/*
 * One-shot, test-bot-only helper for the iOS physical validation handoff.
 *
 * Required environment:
 *   SPLINT_TELEGRAM_TEST_BOT_TOKEN
 *   SPLINT_TELEGRAM_TEST_SERVER=true (for the isolated Telegram test server)
 *   SPLINT_TEST_MINI_APP_URL
 *   SPLINT_EXPECTED_TEST_BOT_USERNAME
 *   SPLINT_TEST_BOT_CONFIRM=I_UNDERSTAND_TEST_BOT_ONLY
 *
 * The token is read in memory only. It is never printed, written, or included
 * in an error. This helper configures only the default private-chat menu
 * button; Main Mini App settings remain an explicit BotFather action.
 */

const TOKEN = process.env.SPLINT_TELEGRAM_TEST_BOT_TOKEN || '';
const APP_URL = process.env.SPLINT_TEST_MINI_APP_URL || '';
const EXPECTED_USERNAME = process.env.SPLINT_EXPECTED_TEST_BOT_USERNAME || '';
const CONFIRM = process.env.SPLINT_TEST_BOT_CONFIRM || '';
const TEST_SERVER = process.env.SPLINT_TELEGRAM_TEST_SERVER === 'true';
const PRODUCTION_HOSTS = new Set(['showalove.ru', 'www.showalove.ru']);

function fail(message) {
  console.error(JSON.stringify({ status: 'FAIL', reason: message }));
  process.exitCode = 1;
}

function requireValue(value, name) {
  if (!value) throw new Error(name + ' is required');
}

function assertSafeUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:') {
    throw new Error('SPLINT_TEST_MINI_APP_URL must use HTTPS');
  }
  if (PRODUCTION_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('production host is forbidden; use a dedicated test preview');
  }
  if (url.username || url.password || url.hash) {
    throw new Error('SPLINT_TEST_MINI_APP_URL must not contain credentials or a fragment');
  }
  return url;
}

async function callBotApi(method, body) {
  const apiPath = TEST_SERVER ? '/test/' : '/';
  const response = await fetch('https://api.telegram.org/bot' + TOKEN + apiPath + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Telegram ' + method + ' returned a non-JSON response (' + response.status + ')');
  }
  if (!response.ok || payload?.ok !== true) {
    throw new Error('Telegram ' + method + ' failed with HTTP ' + response.status);
  }
  return payload.result;
}

try {
  requireValue(TOKEN, 'SPLINT_TELEGRAM_TEST_BOT_TOKEN');
  requireValue(APP_URL, 'SPLINT_TEST_MINI_APP_URL');
  requireValue(EXPECTED_USERNAME, 'SPLINT_EXPECTED_TEST_BOT_USERNAME');
  if (CONFIRM !== 'I_UNDERSTAND_TEST_BOT_ONLY') {
    throw new Error('SPLINT_TEST_BOT_CONFIRM must equal I_UNDERSTAND_TEST_BOT_ONLY');
  }

  const appUrl = assertSafeUrl(APP_URL);
  const bot = await callBotApi('getMe', {});
  if (!bot?.is_bot || !bot.username) {
    throw new Error('getMe did not identify a bot');
  }
  if (bot.username.toLowerCase() !== EXPECTED_USERNAME.replace(/^@/, '').toLowerCase()) {
    throw new Error('getMe username does not match SPLINT_EXPECTED_TEST_BOT_USERNAME');
  }

  await callBotApi('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: 'Open Splint test',
      web_app: { url: appUrl.toString() },
    },
  });

  console.log(JSON.stringify({
    status: 'PASS',
    botUsername: bot.username,
    method: 'setChatMenuButton',
    telegramServer: TEST_SERVER ? 'test' : 'main',
    appOrigin: appUrl.origin,
    appPath: appUrl.pathname,
    productionHostRejected: true,
    tokenOutput: 'none',
  }));
} catch (error) {
  fail(error instanceof Error ? error.message : 'test-bot configuration failed');
}
