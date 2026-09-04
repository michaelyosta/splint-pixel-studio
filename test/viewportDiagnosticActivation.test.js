import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isViewportDiagnosticEnabled,
  readViewportDiagnosticStartParam,
  shouldMountViewportDiagnostic,
} from '../src/diagnostics/viewportDiagnosticActivation.js';

test('query-gated diagnostic activation remains supported', () => {
  assert.equal(isViewportDiagnosticEnabled({ search: '?viewportDiagnostic=1' }), true);
  assert.equal(isViewportDiagnosticEnabled({ search: '?viewportDiagnostic=0' }), false);
  assert.equal(isViewportDiagnosticEnabled({ search: '' }), false);
});

test('exact Telegram viewportDiagnostic start_param activates the same mode', () => {
  const windowRef = {
    location: { search: '' },
    Telegram: { WebApp: { initDataUnsafe: { start_param: 'viewportDiagnostic' } } },
  };
  assert.equal(readViewportDiagnosticStartParam(windowRef), 'viewportDiagnostic');
  assert.equal(shouldMountViewportDiagnostic(windowRef), true);
});

test('Telegram tgWebAppStartParam query activates the same mode', () => {
  assert.equal(
    isViewportDiagnosticEnabled({ search: '?tgWebAppStartParam=viewportDiagnostic' }),
    true,
  );
  assert.equal(
    isViewportDiagnosticEnabled({ search: '?tgWebAppStartParam=viewportDiagnostic%20' }),
    false,
  );
});

test('non-diagnostic Telegram start parameters stay on the ordinary flow', () => {
  const windowRef = {
    location: { search: '' },
    Telegram: { WebApp: { initDataUnsafe: { start_param: 'pack_from-start' } } },
  };
  assert.equal(shouldMountViewportDiagnostic(windowRef), false);
  assert.equal(isViewportDiagnosticEnabled({ startParam: 'viewportDiagnostic=1' }), false);
  assert.equal(isViewportDiagnosticEnabled({ startParam: 'viewportDiagnostic ' }), false);
  assert.equal(isViewportDiagnosticEnabled({ search: '?tgWebAppStartParam=pack_from-start' }), false);
  assert.equal(isViewportDiagnosticEnabled({ search: '?tgWebAppStartParam=viewportDiagnostic=1' }), false);
  assert.equal(isViewportDiagnosticEnabled({ search: '?tgWebAppStartParam=' }), false);
});

test('start-param reader does not inspect unrelated auth or identity fields', () => {
  let forbiddenRead = false;
  const initDataUnsafe = new Proxy({ start_param: 'viewportDiagnostic' }, {
    get(target, property, receiver) {
      if (property !== 'start_param') forbiddenRead = true;
      return Reflect.get(target, property, receiver);
    },
  });
  const webApp = {
    initDataUnsafe,
    get initData() {
      forbiddenRead = true;
      return 'forbidden';
    },
  };
  assert.equal(readViewportDiagnosticStartParam({ Telegram: { WebApp: webApp } }), 'viewportDiagnostic');
  assert.equal(forbiddenRead, false);
});
