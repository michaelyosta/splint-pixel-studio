import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindTelegramVerticalSwipes,
  bindTelegramViewportLifecycle,
  disableTelegramVerticalSwipes,
  enableTelegramVerticalSwipes,
  buildColoringDeepLink,
  buildPackDeepLink,
  buildResultDeepLink,
  getRequestedColoringId,
  getRequestedPackId,
  getTelegramVerticalSwipeStatus,
  invalidateTelegramBottomNavigation,
  isTelegramVersionAtLeast,
  supportsTelegramVerticalSwipes,
  syncTelegramViewportCssVars,
  TELEGRAM_SWIPE_CONTROL_VERSION,
} from './telegram.js';

function withLocationSearch(search, run) {
  const previous = globalThis.window;
  globalThis.window = { location: { search }, Telegram: undefined };
  try {
    return run();
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
}

function supportedWebApp({ version = '7.7', isFullscreen, swipesEnabled = true, initData = 'test-init-data' } = {}) {
  return {
    version,
    isFullscreen,
    initData,
    isVerticalSwipesEnabled: swipesEnabled,
    isVersionAtLeast(minimum) {
      return isTelegramVersionAtLeast(version, minimum);
    },
    disableVerticalSwipes() {
      this.isVerticalSwipesEnabled = false;
    },
    enableVerticalSwipes() {
      this.isVerticalSwipesEnabled = true;
    },
  };
}

function withDocument(run) {
  const previous = globalThis.document;
  const documentElement = {
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    removeAttribute(name) {
      delete this.attrs[name];
    },
  };
  const listeners = [];
  globalThis.document = {
    documentElement,
    addEventListener: (...args) => listeners.push(args),
    removeEventListener: (...args) => listeners.push(args),
  };
  try {
    return run({ documentElement, listeners });
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

test(`vertical swipe control requires WebApp API ${TELEGRAM_SWIPE_CONTROL_VERSION}+`, () => {
  assert.equal(isTelegramVersionAtLeast('7.7'), true);
  assert.equal(isTelegramVersionAtLeast('7.10'), true);
  assert.equal(isTelegramVersionAtLeast('8.0'), true);
  assert.equal(isTelegramVersionAtLeast('7.6'), false);
  assert.equal(isTelegramVersionAtLeast('6.1'), false);
  assert.equal(isTelegramVersionAtLeast(''), false);
  assert.equal(isTelegramVersionAtLeast(undefined), false);
});

test('coloring deep links accept the canonical and legacy query key', () => {
  withLocationSearch('?coloring=color_neon-cat', () => {
    assert.equal(getRequestedColoringId(), 'color_neon-cat');
  });
  withLocationSearch('?coloringId=color_neon-cat', () => {
    assert.equal(getRequestedColoringId(), 'color_neon-cat');
  });
});

test('capability check prefers isVersionAtLeast and falls back to the version field', () => {
  const byCapability = supportedWebApp({ version: '7.8' });
  assert.equal(supportsTelegramVerticalSwipes(byCapability), true);

  const byVersion = {
    version: '7.7',
    isVersionAtLeast: undefined,
    disableVerticalSwipes() {},
    enableVerticalSwipes() {},
  };
  assert.equal(supportsTelegramVerticalSwipes(byVersion), true);

  const oldClient = supportedWebApp({ version: '7.6' });
  assert.equal(supportsTelegramVerticalSwipes(oldClient), false);

  const missingMethods = { version: '7.8', isVersionAtLeast: () => true };
  assert.equal(supportsTelegramVerticalSwipes(missingMethods), false);

  const throwingCapability = {
    version: '7.8',
    isVersionAtLeast() {
      throw new Error('bridge failure');
    },
    disableVerticalSwipes() {},
    enableVerticalSwipes() {},
  };
  assert.equal(supportsTelegramVerticalSwipes(throwingCapability), true);

  assert.equal(supportsTelegramVerticalSwipes(null), false);
  assert.equal(supportsTelegramVerticalSwipes({}), false);
});

test('disable/enable call the official methods only when supported', () => {
  const webApp = supportedWebApp();

  assert.equal(disableTelegramVerticalSwipes(webApp), true);
  assert.equal(webApp.isVerticalSwipesEnabled, false, 'disable mutates the observable bridge state');
  assert.equal(enableTelegramVerticalSwipes(webApp), true);
  assert.equal(webApp.isVerticalSwipesEnabled, true, 'enable mutates the observable bridge state');

  const oldClient = supportedWebApp({ version: '7.6' });
  assert.equal(disableTelegramVerticalSwipes(oldClient), false);
  assert.equal(oldClient.isVerticalSwipesEnabled, true, 'unsupported client is left untouched');
  assert.equal(enableTelegramVerticalSwipes(oldClient), false);
});

test('disable/enable swallow bridge failures and report they were not applied', () => {
  const webApp = supportedWebApp();
  webApp.disableVerticalSwipes = () => { throw new Error('unsupported'); };
  webApp.enableVerticalSwipes = () => { throw new Error('unsupported'); };
  assert.equal(disableTelegramVerticalSwipes(webApp), false);
  assert.equal(enableTelegramVerticalSwipes(webApp), false);
});

test('bind disables on entry and enables on cleanup when swipes were enabled', () => {
  const webApp = supportedWebApp();

  const cleanup = bindTelegramVerticalSwipes(webApp);
  assert.equal(webApp.isVerticalSwipesEnabled, false);
  cleanup();
  assert.equal(webApp.isVerticalSwipesEnabled, true, 'cleanup restores the prior enabled state');
});

test('bind restores the prior disabled state instead of force-enabling on leave', () => {
  const webApp = supportedWebApp({ swipesEnabled: false });

  const cleanup = bindTelegramVerticalSwipes(webApp);
  assert.equal(webApp.isVerticalSwipesEnabled, false);
  cleanup();
  assert.equal(webApp.isVerticalSwipesEnabled, false, 'cleanup preserves the prior disabled state');
});

test('unsupported Telegram versions fall back to a document overscroll marker', () => {
  withDocument(({ documentElement }) => {
    const webApp = supportedWebApp({ version: '7.6' });

    const cleanup = bindTelegramVerticalSwipes(webApp);
    assert.equal(documentElement.attrs['data-tg-swipe-protected'], 'true');
    cleanup();
    assert.equal(documentElement.attrs['data-tg-swipe-protected'], undefined);
    assert.equal(webApp.isVerticalSwipesEnabled, true, 'unsupported fallback does not mutate bridge state');
  });
});

test('browser SDK stubs without initData never apply the global overscroll fallback', () => {
  withDocument(({ documentElement }) => {
    const webApp = supportedWebApp({ version: '7.6', initData: '' });
    const cleanup = bindTelegramVerticalSwipes(webApp);
    assert.deepEqual(documentElement.attrs, {});
    cleanup();
  });
});

test('outside Telegram the lifecycle binder is a no-op', () => {
  withDocument(({ documentElement }) => {
    const cleanup = bindTelegramVerticalSwipes(null);
    cleanup();
    assert.deepEqual(documentElement.attrs, {});
  });
});

test('protection applies independently of Telegram fullscreen state', () => {
  for (const isFullscreen of [undefined, false, true]) {
    const webApp = supportedWebApp({ isFullscreen });
    assert.equal(bindTelegramVerticalSwipes(webApp)(), undefined);
    assert.equal(webApp.isVerticalSwipesEnabled, true, 'cleanup restores state for every fullscreen mode');
  }
});

test('lifecycle binder never registers pointer or touch listeners', () => {
  withDocument(({ listeners }) => {
    const webApp = supportedWebApp({ version: '7.6' });
    bindTelegramVerticalSwipes(webApp)();
    assert.deepEqual(listeners, []);
  });
});

test('official call that leaves observable state enabled is reported as uncertain', () => {
  const webApp = supportedWebApp();
  webApp.disableVerticalSwipes = () => {
    // Telegram accepted the call but still reports swipes enabled.
  };
  const cleanup = bindTelegramVerticalSwipes(webApp);
  const status = getTelegramVerticalSwipeStatus(webApp);
  assert.equal(status.apiSupported, true);
  assert.equal(status.protectionApplied, false);
  assert.equal(status.uncertain, true, 'diagnostics must not claim protection when state stayed enabled');
  cleanup();
});

test('artwork and pack deep links carry only the bounded route identifiers', () => {
  const previous = globalThis.window;
  globalThis.window = {
    location: { origin: 'https://splint.example', pathname: '/mini-app', search: '' },
    Telegram: { WebApp: { initDataUnsafe: { start_param: '' } } },
  };
  try {
    assert.equal(buildColoringDeepLink('art/1'), 'https://splint.example/mini-app?coloring=art%2F1');
    assert.equal(buildColoringDeepLink('art-1', { packId: 'pack-1' }), 'https://splint.example/mini-app?coloring=art-1&pack=pack-1');
    assert.equal(buildPackDeepLink('pack one'), 'https://splint.example/mini-app?pack=pack+one');
    assert.equal(buildResultDeepLink({ artworkId: 'art-1', packId: 'pack-1' }), 'https://splint.example/mini-app?coloring=art-1&pack=pack-1');
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test('deep-link readers accept query and Telegram start parameters', () => {
  const previous = globalThis.window;
  globalThis.window = {
    location: { search: '?pack=pack-query' },
    Telegram: { WebApp: { initDataUnsafe: { start_param: 'coloring_from-start' } } },
  };
  try {
    assert.equal(getRequestedPackId(), 'pack-query');
    assert.equal(getRequestedColoringId(), 'from-start');
    globalThis.window.location.search = '';
    globalThis.window.Telegram.WebApp.initDataUnsafe.start_param = 'pack_from-start';
    assert.equal(getRequestedPackId(), 'from-start');
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

function viewportWebApp({ platform = 'ios', initData = 'test-init-data', ...extra } = {}) {
  const handlers = new Map();
  return {
    platform,
    initData,
    viewportStableHeight: 734,
    viewportHeight: 734,
    ...extra,
    onEvent(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
    },
    offEvent(event, handler) {
      const list = handlers.get(event) || [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    emit(event, payload) {
      for (const handler of handlers.get(event) || []) handler(payload);
    },
    listenerCount(event) {
      return (handlers.get(event) || []).length;
    },
  };
}

function withViewportDocument(run) {
  const previousDocument = globalThis.document;
  const previousRaf = globalThis.requestAnimationFrame;
  const setProperties = [];
  const rafQueue = [];
  const bar = {
    repaintClass: false,
    rectReads: 0,
    classList: {
      add(name) {
        assert.equal(name, 'app-tab-bar--repaint');
        this.mark(true);
      },
      remove(name) {
        assert.equal(name, 'app-tab-bar--repaint');
        this.mark(false);
      },
      mark(visible) {
        bar.repaintClass = visible;
      },
    },
    getBoundingClientRect() {
      bar.rectReads += 1;
      return { top: 700, bottom: 768 };
    },
  };
  globalThis.document = {
    documentElement: {
      style: {
        setProperty(name, value) {
          setProperties.push([name, value]);
        },
      },
      attrs: {},
      setAttribute(name, value) {
        this.attrs[name] = value;
      },
      removeAttribute(name) {
        delete this.attrs[name];
      },
    },
    querySelector(selector) {
      return selector === '.app-tab-bar' ? bar : null;
    },
  };
  globalThis.requestAnimationFrame = (callback) => {
    rafQueue.push(callback);
    return rafQueue.length;
  };
  try {
    return run({ bar, rafQueue, setProperties });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousRaf === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousRaf;
  }
}

test('viewport CSS variable sync publishes stable height and insets', () => {
  withViewportDocument(({ setProperties }) => {
    const webApp = viewportWebApp({
      viewportStableHeight: 700,
      safeAreaInset: { top: 59, bottom: 34, left: 0, right: 0 },
      contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    assert.equal(syncTelegramViewportCssVars(webApp), true);
    assert.deepEqual(setProperties, [
      ['--tg-viewport-stable-height', '700px'],
      ['--tg-safe-area-inset-top', '59px'],
      ['--tg-content-safe-area-inset-top', '0px'],
      ['--tg-safe-area-inset-right', '0px'],
      ['--tg-content-safe-area-inset-right', '0px'],
      ['--tg-safe-area-inset-bottom', '34px'],
      ['--tg-content-safe-area-inset-bottom', '0px'],
      ['--tg-safe-area-inset-left', '0px'],
      ['--tg-content-safe-area-inset-left', '0px'],
    ]);
  });
});

test('viewport CSS variable sync rejects unusable bridge values', () => {
  withViewportDocument(({ setProperties }) => {
    assert.equal(syncTelegramViewportCssVars(viewportWebApp({ viewportStableHeight: undefined, viewportHeight: undefined })), false);
    assert.equal(syncTelegramViewportCssVars(viewportWebApp({ viewportStableHeight: -5, viewportHeight: -3 })), false);
    assert.equal(syncTelegramViewportCssVars(null), false);
    assert.deepEqual(setProperties, []);
  });
});

test('iOS Telegram sessions are marked for compositor-scoped CSS', () => {
  withViewportDocument(({ setProperties }) => {
    const root = globalThis.document.documentElement;
    const iosApp = viewportWebApp({ platform: 'ios' });
    assert.equal(bindTelegramViewportLifecycle(iosApp)(), undefined);
    assert.equal(root.attrs['data-tg-ios'], '1');

    const androidApp = viewportWebApp({ platform: 'android' });
    assert.equal(bindTelegramViewportLifecycle(androidApp)(), undefined);
    assert.equal(root.attrs['data-tg-ios'], '1', 'iOS marker from the prior session stays');
    assert.deepEqual(setProperties.map(([name]) => name), ['--tg-viewport-stable-height', '--tg-viewport-stable-height']);
  });
});

test('lifecycle binder subscribes to the four Telegram viewport events', () => {
  withViewportDocument(() => {
    const webApp = viewportWebApp();
    const cleanup = bindTelegramViewportLifecycle(webApp);
    for (const event of ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged']) {
      assert.equal(webApp.listenerCount(event), 1, `${event} has exactly one handler`);
    }
    cleanup();
    for (const event of ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged']) {
      assert.equal(webApp.listenerCount(event), 0, `${event} handler removed on cleanup`);
    }
  });
});

test('viewportChanged commits only stable states and repaints navigation once', () => {
  withViewportDocument(({ bar, rafQueue, setProperties }) => {
    const webApp = viewportWebApp({ viewportStableHeight: 600 });
    bindTelegramViewportLifecycle(webApp);

    webApp.emit('viewportChanged', { height: 500, isStateStable: false });
    assert.deepEqual(setProperties, [['--tg-viewport-stable-height', '600px']], 'initial sync only');
    assert.equal(bar.repaintClass, false);

    webApp.viewportStableHeight = 500;
    webApp.emit('viewportChanged', { height: 500, isStateStable: true });
    assert.deepEqual(setProperties.slice(1), [['--tg-viewport-stable-height', '500px']]);
    assert.equal(bar.repaintClass, true, 'repaint class applied one-shot');
    assert.equal(bar.rectReads, 1, 'exactly one bounded layout read');
    assert.equal(rafQueue.length, 1, 'revert scheduled on the next frame');

    rafQueue[0]();
    assert.equal(bar.repaintClass, false, 'repaint class removed next frame');
    assert.equal(rafQueue.length, 1, 'no polling or animation loops');

    webApp.emit('viewportChanged', { height: 500, isStateStable: true });
    assert.equal(rafQueue.length, 2, 'each stable state invalidates at most once');
  });
});

test('viewport events without a stability flag count as committed states', () => {
  withViewportDocument(({ bar, setProperties }) => {
    const webApp = viewportWebApp({ safeAreaInset: { top: 10, bottom: 20, left: 0, right: 0 } });
    bindTelegramViewportLifecycle(webApp);
    const initialCount = setProperties.length;
    webApp.emit('safeAreaChanged', { safeAreaInset: webApp.safeAreaInset });
    assert.deepEqual(setProperties.slice(initialCount), [
      ['--tg-viewport-stable-height', '734px'],
      ['--tg-safe-area-inset-top', '10px'],
      ['--tg-safe-area-inset-right', '0px'],
      ['--tg-safe-area-inset-bottom', '20px'],
      ['--tg-safe-area-inset-left', '0px'],
    ]);
    assert.equal(bar.repaintClass, true);
  });
});

test('non-iOS Telegram sessions sync variables without compositor repaint', () => {
  withViewportDocument(({ bar, rafQueue }) => {
    const webApp = viewportWebApp({ platform: 'desktop' });
    bindTelegramViewportLifecycle(webApp);
    webApp.emit('viewportChanged', { height: 600, isStateStable: true });
    assert.equal(bar.repaintClass, false, 'desktop never triggers the iOS compositor workaround');
    assert.equal(rafQueue.length, 0);
  });
});

test('browser SDK stubs without initData never run the compositor workaround', () => {
  withViewportDocument(({ bar, rafQueue, setProperties }) => {
    const webApp = viewportWebApp({ platform: 'ios', initData: '' });
    bindTelegramViewportLifecycle(webApp);
    webApp.emit('viewportChanged', { height: 600, isStateStable: true });
    assert.deepEqual(setProperties.map(([name]) => name), ['--tg-viewport-stable-height', '--tg-viewport-stable-height']);
    assert.equal(bar.repaintClass, false);
    assert.equal(rafQueue.length, 0);
  });
});

test('one-shot invalidation is a no-op without a rendered navigation', () => {
  withViewportDocument(() => {
    globalThis.document.querySelector = () => null;
    assert.equal(invalidateTelegramBottomNavigation(), false);
  });
});
