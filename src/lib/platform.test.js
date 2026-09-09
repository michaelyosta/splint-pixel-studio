import test from 'node:test';
import assert from 'node:assert/strict';
import { getPlatformSnapshot, isTelegramHost } from './platform.js';

function installWindow(value) {
  globalThis.window = value;
}

test('browser platform has graceful capability fallbacks', () => {
  installWindow({
    innerWidth: 390,
    innerHeight: 844,
    navigator: {},
  });
  const platform = getPlatformSnapshot();
  assert.equal(platform.isBrowser, true);
  assert.equal(platform.isTelegram, false);
  assert.equal(platform.viewport.width, 390);
  assert.equal(platform.canUseTelegramPayments, false);
  assert.equal(platform.canUseHaptics, false);
});

test('Telegram host is detected from initData or an explicit host platform', () => {
  const realMiniApp = { initData: 'signed-query', platform: 'ios', HapticFeedback: {}, openInvoice() {}, onEvent() {} };
  assert.equal(isTelegramHost(realMiniApp), true);
  installWindow({ innerWidth: 1280, innerHeight: 800, Telegram: { WebApp: realMiniApp }, navigator: {} });
  const platform = getPlatformSnapshot();
  assert.equal(platform.isTelegram, true);
  assert.equal(platform.isTelegramIOS, true);
  assert.equal(platform.isBrowser, false);
  assert.equal(platform.authMode, 'telegram_init_data');
  assert.equal(platform.canUseTelegramPayments, true);

  assert.equal(isTelegramHost({ ready() {} }), false);
  assert.equal(isTelegramHost({ platform: 'tdesktop', ready() {} }), true);
});
