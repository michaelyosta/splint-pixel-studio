import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectViewportDiagnosticSnapshot,
  formatViewportDiagnosticSnapshot,
} from '../src/diagnostics/viewportDiagnostic.js';

function element(rect) {
  return { getBoundingClientRect: () => ({ ...rect }) };
}

test('viewport diagnostic captures Telegram, visual viewport and layout overlap without auth data', () => {
  const html = element({ x: 0, y: 0, width: 390, height: 844, top: 0, right: 390, bottom: 844, left: 0 });
  const body = element({ x: 0, y: 0, width: 390, height: 844, top: 0, right: 390, bottom: 844, left: 0 });
  const root = element({ x: 0, y: 0, width: 390, height: 844, top: 0, right: 390, bottom: 844, left: 0 });
  const frame = element({ x: 0, y: 0, width: 390, height: 844, top: 0, right: 390, bottom: 844, left: 0 });
  const container = element({ x: 0, y: 0, width: 390, height: 844, top: 0, right: 390, bottom: 844, left: 0 });
  const screenContent = element({ x: 0, y: 60, width: 390, height: 784, top: 60, right: 390, bottom: 844, left: 0 });
  const tabBar = element({ x: 10, y: 760, width: 370, height: 68, top: 760, right: 380, bottom: 828, left: 10 });
  const elements = { '#root': root, '.telegram-frame': frame, '.app-container': container, '.screen-content': screenContent, '.app-tab-bar': tabBar };
  const cssVariables = {
    '--tg-viewport-height': '844px',
    '--tg-viewport-stable-height': '844px',
    '--tg-safe-area-inset-top': '0px',
    '--tg-safe-area-inset-right': '0px',
    '--tg-safe-area-inset-bottom': '34px',
    '--tg-safe-area-inset-left': '0px',
    '--tg-content-safe-area-inset-top': '0px',
    '--tg-content-safe-area-inset-right': '0px',
    '--tg-content-safe-area-inset-bottom': '34px',
    '--tg-content-safe-area-inset-left': '0px',
  };
  const style = {
    position: 'absolute',
    top: '0px',
    right: '10px',
    bottom: '10px',
    left: '10px',
    width: '370px',
    height: '68px',
    maxHeight: '844px',
    paddingBottom: '34px',
    overflowY: 'auto',
    zIndex: '20',
    getPropertyValue: (name) => cssVariables[name] || '',
  };
  const documentRef = {
    documentElement: html,
    body,
    querySelector: (selector) => elements[selector] || null,
  };
  const windowRef = {
    innerWidth: 390,
    innerHeight: 844,
    devicePixelRatio: 3,
    visualViewport: {
      width: 390,
      height: 844,
      offsetLeft: 0,
      offsetTop: 0,
      pageLeft: 0,
      pageTop: 0,
      scale: 1,
    },
    Telegram: {
      WebApp: {
        viewportHeight: 844,
        viewportStableHeight: 844,
        safeAreaInsets: { top: 0, right: 0, bottom: 34, left: 0 },
        contentSafeAreaInsets: { top: 0, right: 0, bottom: 34, left: 0 },
        initData: 'must-not-be-read-or-rendered',
      },
    },
  };

  const snapshot = collectViewportDiagnosticSnapshot({
    windowRef,
    documentRef,
    getComputedStyleRef: () => style,
  });
  const formatted = formatViewportDiagnosticSnapshot(snapshot);

  assert.equal(snapshot.window.innerHeight, 844);
  assert.equal(snapshot.visualViewport.offsetTop, 0);
  assert.equal(snapshot.visualViewport.scale, 1);
  assert.equal(snapshot.telegram.viewportHeight, 844);
  assert.equal(snapshot.telegram.viewportStableHeight, 844);
  assert.equal(snapshot.telegram.safeAreaInsets.bottom, 34);
  assert.equal(snapshot.telegram.contentSafeAreaInsets.bottom, 34);
  assert.equal(snapshot.cssVariables['--tg-content-safe-area-inset-bottom'], '34px');
  assert.equal(snapshot.rects.root.width, 390);
  assert.equal(snapshot.rects.frame.height, 844);
  assert.equal(snapshot.rects.tabBar.bottom, 828);
  assert.equal(snapshot.overlaps.rootFrame.intersects, true);
  assert.equal(snapshot.overlaps.frameTabBar.intersects, true);
  assert.equal(snapshot.overlaps.screenContentTabBar.area, 25160);
  assert.equal(snapshot.positions.tabBar.position, 'absolute');
  assert.match(formatted, /telegram\.viewportStableHeight: 844\.00/);
  assert.match(formatted, /visualViewport: .*offsetTop=0\.00 .*scale=1\.00/);
  assert.match(formatted, /rect \.app-tab-bar: .*right=380\.00 .*left=10\.00/);
  assert.match(formatted, /overlap \.screen-content × \.app-tab-bar: yes/);
  assert.doesNotMatch(formatted, /must-not-be-read-or-rendered|initData/);
});

test('viewport diagnostic keeps unavailable fields explicit when bridges or elements are absent', () => {
  const snapshot = collectViewportDiagnosticSnapshot({
    windowRef: { innerHeight: 700, Telegram: { WebApp: {} } },
    documentRef: {
      documentElement: null,
      body: null,
      querySelector: () => null,
    },
    getComputedStyleRef: () => ({ getPropertyValue: () => '' }),
  });
  const formatted = formatViewportDiagnosticSnapshot(snapshot);

  assert.equal(snapshot.visualViewport, null);
  assert.equal(snapshot.telegram.safeAreaInsets, null);
  assert.equal(snapshot.rects.root, null);
  assert.equal(snapshot.overlaps.rootFrame.available, false);
  assert.match(formatted, /window\.inner: unavailablex700\.00/);
  assert.match(formatted, /visualViewport: unavailable/);
  assert.match(formatted, /rect #root: unavailable/);
  assert.match(formatted, /overlap #root × \.telegram-frame: unavailable/);
});
