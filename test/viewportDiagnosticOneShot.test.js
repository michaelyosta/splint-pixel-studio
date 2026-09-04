import test from 'node:test';
import assert from 'node:assert/strict';

import {
  armViewportDiagnosticVariant,
  consumeViewportDiagnosticVariant,
  resolveViewportDiagnosticOneShot,
  VIEWPORT_DIAGNOSTIC_MARKER_KEY,
  VIEWPORT_DIAGNOSTIC_MARKER_TTL_MS,
} from '../src/diagnostics/viewportDiagnosticOneShot.js';

const NOW = 1_000_000;

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function makeWindow({ search = '', startParam = null, storage = makeStorage() } = {}) {
  return {
    location: { search },
    localStorage: storage,
    Telegram: {
      WebApp: {
        initDataUnsafe: { start_param: startParam },
      },
    },
  };
}

test('each exact variant arms a marker without mounting an experiment', () => {
  const starts = [
    ['viewportDiagnostic_baseline', 'baseline'],
    ['viewportDiagnostic_noBackdrop', 'noBackdrop'],
    ['viewportDiagnostic_promotedLayer', 'promotedLayer'],
  ];

  for (const [startParam, variant] of starts) {
    const storage = makeStorage();
    const windowRef = makeWindow({ search: '?mode=compact', startParam, storage });
    const phase = resolveViewportDiagnosticOneShot({ windowRef, now: NOW });

    assert.deepEqual(phase, { mode: 'arm', variant, armed: true, createdAt: NOW });
    assert.equal(storage.values.has(VIEWPORT_DIAGNOSTIC_MARKER_KEY), true);
    assert.deepEqual(JSON.parse(storage.values.get(VIEWPORT_DIAGNOSTIC_MARKER_KEY)), {
      variant,
      createdAt: NOW,
    });
    // Direct full-height/deep-link arming is only a marker phase.
    assert.notEqual(phase.mode, 'consume');
  }
});

test('query arming maps exactly and ignores mode=compact as a separate signal', () => {
  const storage = makeStorage();
  const windowRef = makeWindow({
    search: '?startapp=ignored&mode=compact&viewportDiagnosticVariant=viewportDiagnostic_noBackdrop',
    storage,
  });
  assert.deepEqual(
    resolveViewportDiagnosticOneShot({ windowRef, now: NOW }),
    { mode: 'arm', variant: 'noBackdrop', armed: true, createdAt: NOW },
  );
});

test('ordinary launch consumes a marker exactly once and removes it immediately', () => {
  const storage = makeStorage();
  const ordinaryWindow = makeWindow({ storage });
  assert.deepEqual(
    armViewportDiagnosticVariant({ windowRef: ordinaryWindow, variant: 'promotedLayer', now: NOW }),
    { armed: true, variant: 'promotedLayer', createdAt: NOW },
  );
  assert.deepEqual(
    resolveViewportDiagnosticOneShot({ windowRef: ordinaryWindow, now: NOW + 1 }),
    { mode: 'consume', variant: 'promotedLayer' },
  );
  assert.equal(storage.getItem(VIEWPORT_DIAGNOSTIC_MARKER_KEY), null);
  assert.deepEqual(resolveViewportDiagnosticOneShot({ windowRef: ordinaryWindow, now: NOW + 2 }), {
    mode: 'ordinary',
    variant: null,
  });
});

test('ordinary launch without a marker remains unchanged', () => {
  const phase = resolveViewportDiagnosticOneShot({ windowRef: makeWindow(), now: NOW });
  assert.deepEqual(phase, { mode: 'ordinary', variant: null });
});

test('expired, unknown and malformed markers are removed without activation', () => {
  const cases = [
    JSON.stringify({ variant: 'baseline', createdAt: NOW - VIEWPORT_DIAGNOSTIC_MARKER_TTL_MS - 1 }),
    JSON.stringify({ variant: 'future_variant', createdAt: NOW }),
    '{malformed',
  ];

  for (const rawMarker of cases) {
    const storage = makeStorage({ [VIEWPORT_DIAGNOSTIC_MARKER_KEY]: rawMarker });
    const windowRef = makeWindow({ storage });
    assert.equal(consumeViewportDiagnosticVariant({ windowRef, now: NOW }), null);
    assert.equal(storage.getItem(VIEWPORT_DIAGNOSTIC_MARKER_KEY), null);
  }
});

test('invalid direct variants do not arm, and marker contains no auth or identity data', () => {
  const storage = makeStorage();
  const windowRef = makeWindow({
    search: '?viewportDiagnosticVariant=viewportDiagnostic_noBackdrop%20',
    startParam: 'viewportDiagnostic_unknown',
    storage,
  });
  assert.deepEqual(resolveViewportDiagnosticOneShot({ windowRef, now: NOW }), {
    mode: 'ordinary',
    variant: null,
  });
  assert.equal(storage.getItem(VIEWPORT_DIAGNOSTIC_MARKER_KEY), null);

  armViewportDiagnosticVariant({ windowRef, variant: 'baseline', now: NOW });
  const marker = storage.getItem(VIEWPORT_DIAGNOSTIC_MARKER_KEY);
  assert.equal(marker.includes('initData'), false);
  assert.equal(marker.includes('user'), false);
  assert.equal(marker.includes('token'), false);
  assert.equal(marker.includes('cookie'), false);
  assert.deepEqual(Object.keys(JSON.parse(marker)).sort(), ['createdAt', 'variant']);
});

test('start parameter reader only accesses the exact Telegram start_param field', () => {
  let inspectedUnrelatedField = false;
  const initDataUnsafe = new Proxy({ start_param: 'viewportDiagnostic_baseline' }, {
    get(target, property, receiver) {
      if (property !== 'start_param') inspectedUnrelatedField = true;
      return Reflect.get(target, property, receiver);
    },
  });
  const windowRef = {
    location: { search: '' },
    localStorage: makeStorage(),
    Telegram: { WebApp: { initDataUnsafe } },
  };
  assert.deepEqual(resolveViewportDiagnosticOneShot({ windowRef, now: NOW }), {
    mode: 'arm',
    variant: 'baseline',
    armed: true,
    createdAt: NOW,
  });
  assert.equal(inspectedUnrelatedField, false);
});
