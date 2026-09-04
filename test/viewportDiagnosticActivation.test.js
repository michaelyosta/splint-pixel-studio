import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isViewportDiagnosticEnabled,
  readViewportDiagnosticStartParam,
  readViewportDiagnosticVariant,
  resolveViewportDiagnosticVariant,
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

test('exact experiment start parameters map deterministically to variants', () => {
  assert.equal(readViewportDiagnosticVariant({ startParam: 'viewportDiagnostic_baseline' }), 'baseline');
  assert.equal(readViewportDiagnosticVariant({ startParam: 'viewportDiagnostic_noBackdrop' }), 'noBackdrop');
  assert.equal(readViewportDiagnosticVariant({ startParam: 'viewportDiagnostic_promotedLayer' }), 'promotedLayer');
  assert.equal(
    readViewportDiagnosticVariant({ search: '?tgWebAppStartParam=viewportDiagnostic_noBackdrop' }),
    'noBackdrop',
  );
  assert.equal(
    readViewportDiagnosticVariant({ search: '?viewportDiagnosticVariant=viewportDiagnostic_promotedLayer' }),
    'promotedLayer',
  );
  assert.equal(readViewportDiagnosticVariant({ search: '?viewportDiagnostic=1' }), 'baseline');
});

test('unknown, malformed and ordinary launches install no diagnostic variant', () => {
  const ordinaryWindow = { location: { search: '' }, Telegram: { WebApp: {} } };
  assert.equal(readViewportDiagnosticVariant({ startParam: 'viewportDiagnostic_unknown' }), null);
  assert.equal(readViewportDiagnosticVariant({ startParam: 'viewportDiagnostic_noBackdrop ' }), null);
  assert.equal(readViewportDiagnosticVariant({ search: '?tgWebAppStartParam=viewportDiagnostic_noBackdrop%20' }), null);
  assert.equal(readViewportDiagnosticVariant({ search: '?viewportDiagnosticVariant=viewportDiagnostic_promotedLayer=1' }), null);
  assert.equal(readViewportDiagnosticVariant({ search: '?viewportDiagnostic=0' }), null);
  assert.equal(resolveViewportDiagnosticVariant(ordinaryWindow), null);
  assert.equal(shouldMountViewportDiagnostic(ordinaryWindow), false);
  assert.equal(isViewportDiagnosticEnabled({ search: '?tgWebAppStartParam=unknown' }), false);
});

test('non-diagnostic Telegram start parameters stay on the ordinary flow', () => {
  const windowRef = {
    location: { search: '' },
    Telegram: { WebApp: { initDataUnsafe: { start_param: 'pack_from-start' } } },
  };
  assert.equal(shouldMountViewportDiagnostic(windowRef), false);
  assert.equal(isViewportDiagnosticEnabled({ startParam: 'viewportDiagnostic=1' }), false);
  assert.equal(isViewportDiagnosticEnabled({ startParam: 'viewportDiagnostic ' }), false);
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
