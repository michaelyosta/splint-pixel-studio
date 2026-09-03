const TELEGRAM_VIEWPORT_CSS_VARIABLES = [
  '--tg-viewport-height',
  '--tg-viewport-stable-height',
  '--tg-safe-area-inset-top',
  '--tg-safe-area-inset-right',
  '--tg-safe-area-inset-bottom',
  '--tg-safe-area-inset-left',
  '--tg-content-safe-area-inset-top',
  '--tg-content-safe-area-inset-right',
  '--tg-content-safe-area-inset-bottom',
  '--tg-content-safe-area-inset-left',
];

const POSITION_KEYS = [
  'position', 'top', 'right', 'bottom', 'left', 'width', 'height',
  'maxHeight', 'paddingBottom', 'overflowY', 'zIndex',
];

// Keep this list deliberately small: these are the computed paint properties
// that can make a hit-testable element disappear in a target WebView. Do not
// include text, attributes, or arbitrary DOM payloads in the diagnostic.
const PAINT_KEYS = [
  'display', 'visibility', 'opacity', 'backgroundColor', 'color',
  'filter', 'backdropFilter', 'transform', 'mixBlendMode', 'isolation',
];

const DIAGNOSTIC_PAGE_IDS = ['viewport', 'telegram', 'layout', 'overlap'];
const DIAGNOSTIC_PAGE_INTERVAL_MS = 1800;

function finiteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function formatNumber(value) {
  const number = finiteNumber(value);
  return number == null ? 'unavailable' : number.toFixed(2);
}

function readRect(element) {
  if (!element || typeof element.getBoundingClientRect !== 'function') return null;
  const rect = element.getBoundingClientRect();
  if (!rect) return null;
  const x = finiteNumber(rect.x);
  const y = finiteNumber(rect.y);
  const width = finiteNumber(rect.width);
  const height = finiteNumber(rect.height);
  return {
    x,
    y,
    width,
    height,
    top: finiteNumber(rect.top) ?? y,
    right: finiteNumber(rect.right) ?? (x != null && width != null ? x + width : null),
    bottom: finiteNumber(rect.bottom) ?? (y != null && height != null ? y + height : null),
    left: finiteNumber(rect.left) ?? x,
  };
}

function readStyleValue(style, key) {
  if (!style) return null;
  const value = style[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readPosition(element, getComputedStyleRef) {
  if (!element || typeof getComputedStyleRef !== 'function') return null;
  let style;
  try {
    style = getComputedStyleRef(element);
  } catch {
    return null;
  }
  if (!style) return null;
  return Object.fromEntries(POSITION_KEYS.map((key) => [key, readStyleValue(style, key)]));
}

function readPaint(element, getComputedStyleRef) {
  if (!element || typeof getComputedStyleRef !== 'function') return null;
  let style;
  try {
    style = getComputedStyleRef(element);
  } catch {
    return null;
  }
  if (!style) return null;
  return Object.fromEntries(PAINT_KEYS.map((key) => [key, readStyleValue(style, key)]));
}

function describeHitTarget(element) {
  if (!element) return 'none';
  let target = element;
  try {
    // elementFromPoint may return an icon/span inside a button. Report the
    // actionable ancestor so a visual-vs-hit-test comparison is meaningful.
    target = element.closest?.('button') || element;
  } catch {
    target = element;
  }
  const tag = String(target.tagName || target.nodeName || 'unknown').toLowerCase();
  const className = typeof target.className === 'string'
    ? target.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
    : '';
  return className ? `${tag}.${className}` : tag;
}

function readHitTarget(documentRef, rect) {
  if (typeof documentRef?.elementFromPoint !== 'function' || !rect) return null;
  if (![rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite)) return null;
  try {
    return describeHitTarget(documentRef.elementFromPoint(
      (rect.left + rect.right) / 2,
      (rect.top + rect.bottom) / 2,
    ));
  } catch {
    return null;
  }
}

function readInsets(webApp, pluralKey, singularKey) {
  const source = webApp?.[pluralKey] ?? webApp?.[singularKey];
  if (!source || typeof source !== 'object') return null;
  return Object.fromEntries(['top', 'right', 'bottom', 'left'].map((side) => [
    side,
    finiteNumber(source[side]),
  ]));
}

function readVisualViewport(viewport) {
  if (!viewport) return null;
  return Object.fromEntries([
    ['width', viewport.width],
    ['height', viewport.height],
    ['offsetLeft', viewport.offsetLeft],
    ['offsetTop', viewport.offsetTop],
    ['pageLeft', viewport.pageLeft],
    ['pageTop', viewport.pageTop],
    ['scale', viewport.scale],
  ].map(([key, value]) => [key, finiteNumber(value)]));
}

function overlap(first, second) {
  if (!first || !second) return { available: false, intersects: false };
  const left = Math.max(first.left ?? -Infinity, second.left ?? -Infinity);
  const top = Math.max(first.top ?? -Infinity, second.top ?? -Infinity);
  const right = Math.min(first.right ?? Infinity, second.right ?? Infinity);
  const bottom = Math.min(first.bottom ?? Infinity, second.bottom ?? Infinity);
  if (![left, top, right, bottom].every(Number.isFinite)) {
    return { available: false, intersects: false };
  }
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  return {
    available: true,
    intersects: width > 0 && height > 0,
    x: left,
    y: top,
    width,
    height,
    area: width * height,
  };
}

function formatRect(rect) {
  if (!rect) return 'unavailable';
  return ['x', 'y', 'width', 'height', 'top', 'right', 'bottom', 'left']
    .map((key) => `${key}=${formatNumber(rect[key])}`)
    .join(' ');
}

function formatPosition(position) {
  if (!position) return 'unavailable';
  return POSITION_KEYS
    .map((key) => `${key}=${position[key] || 'unavailable'}`)
    .join(' ');
}

function formatPaint(paint) {
  if (!paint) return 'unavailable';
  return [
    `display=${paint.display || 'unavailable'}`,
    `visibility=${paint.visibility || 'unavailable'}`,
    `opacity=${paint.opacity || 'unavailable'}`,
    `bg=${paint.backgroundColor || 'unavailable'}`,
    `color=${paint.color || 'unavailable'}`,
    `filter=${paint.filter || 'unavailable'}`,
    `backdrop=${paint.backdropFilter || 'unavailable'}`,
    `transform=${paint.transform || 'unavailable'}`,
  ].join(' ');
}

function formatInsets(insets) {
  if (!insets) return 'unavailable';
  return ['top', 'right', 'bottom', 'left']
    .map((side) => `${side}=${formatNumber(insets[side])}`)
    .join(' ');
}

function formatVisualViewport(viewport) {
  if (!viewport) return 'unavailable';
  return [
    `width=${formatNumber(viewport.width)}`,
    `height=${formatNumber(viewport.height)}`,
    `offsetLeft=${formatNumber(viewport.offsetLeft)}`,
    `offsetTop=${formatNumber(viewport.offsetTop)}`,
    `pageLeft=${formatNumber(viewport.pageLeft)}`,
    `pageTop=${formatNumber(viewport.pageTop)}`,
    `scale=${formatNumber(viewport.scale)}`,
  ].join(' ');
}

function formatOverlap(value) {
  if (!value?.available) return 'unavailable';
  return `${value.intersects ? 'yes' : 'no'} x=${formatNumber(value.x)} y=${formatNumber(value.y)} width=${formatNumber(value.width)} height=${formatNumber(value.height)} area=${formatNumber(value.area)}`;
}

function pageIndex(value) {
  if (Number.isInteger(value) && value >= 0 && value < DIAGNOSTIC_PAGE_IDS.length) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (/^\d+$/.test(normalized)) {
    const index = Number(normalized) - 1;
    return index >= 0 && index < DIAGNOSTIC_PAGE_IDS.length ? index : null;
  }
  const index = DIAGNOSTIC_PAGE_IDS.indexOf(normalized);
  return index >= 0 ? index : null;
}

/** Resolves a static page selection; null means the deterministic auto-cycle. */
export function resolveViewportDiagnosticPage(search = '') {
  const value = new URLSearchParams(String(search || '')).get('viewportDiagnosticPage');
  if (!value || value.trim().toLowerCase() === 'auto') return null;
  return pageIndex(value);
}

export function collectViewportDiagnosticSnapshot({
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  getComputedStyleRef = globalThis.getComputedStyle,
} = {}) {
  const root = documentRef?.documentElement || null;
  const elements = {
    documentElement: root,
    body: documentRef?.body || null,
    root: documentRef?.querySelector?.('#root') || null,
    frame: documentRef?.querySelector?.('.telegram-frame') || null,
    container: documentRef?.querySelector?.('.app-container') || null,
    screenContent: documentRef?.querySelector?.('.screen-content') || null,
    tabBar: documentRef?.querySelector?.('.app-tab-bar') || null,
  };
  let navItems = [];
  try {
    navItems = Array.from(documentRef?.querySelectorAll?.('.app-tab-bar > button') || []).slice(0, 3);
  } catch {
    navItems = [];
  }
  const rects = Object.fromEntries(Object.entries(elements).map(([key, element]) => [key, readRect(element)]));
  const navItemRects = navItems.map((element) => readRect(element));
  const positions = Object.fromEntries(
    Object.entries(elements).map(([key, element]) => [key, readPosition(element, getComputedStyleRef)]),
  );
  const paints = Object.fromEntries(
    Object.entries(elements).map(([key, element]) => [key, readPaint(element, getComputedStyleRef)]),
  );
  let cssVariables = Object.fromEntries(TELEGRAM_VIEWPORT_CSS_VARIABLES.map((name) => [name, null]));
  try {
    const computedRoot = typeof getComputedStyleRef === 'function' ? getComputedStyleRef(root) : null;
    cssVariables = Object.fromEntries(TELEGRAM_VIEWPORT_CSS_VARIABLES.map((name) => {
      const value = computedRoot?.getPropertyValue?.(name)?.trim() || null;
      return [name, value];
    }));
  } catch {
    // Keep unavailable values; this preview must remain diagnostic-only.
  }

  const webApp = windowRef?.Telegram?.WebApp || null;
  const telegram = {
    viewportHeight: finiteNumber(webApp?.viewportHeight),
    viewportStableHeight: finiteNumber(webApp?.viewportStableHeight),
    safeAreaInsets: readInsets(webApp, 'safeAreaInsets', 'safeAreaInset'),
    contentSafeAreaInsets: readInsets(webApp, 'contentSafeAreaInsets', 'contentSafeAreaInset'),
  };
  return {
    window: {
      innerWidth: finiteNumber(windowRef?.innerWidth),
      innerHeight: finiteNumber(windowRef?.innerHeight),
      devicePixelRatio: finiteNumber(windowRef?.devicePixelRatio),
    },
    visualViewport: readVisualViewport(windowRef?.visualViewport),
    telegram,
    cssVariables,
    rects,
    navItems: navItems.map((element, index) => ({
      index,
      rect: navItemRects[index],
      paint: readPaint(element, getComputedStyleRef),
      hitTarget: readHitTarget(documentRef, navItemRects[index]),
    })),
    positions: {
      root: positions.root,
      frame: positions.frame,
      tabBar: positions.tabBar,
      screenContent: positions.screenContent,
    },
    paints: {
      tabBar: paints.tabBar,
    },
    overlaps: {
      rootFrame: overlap(rects.root, rects.frame),
      frameTabBar: overlap(rects.frame, rects.tabBar),
      screenContentTabBar: overlap(rects.screenContent, rects.tabBar),
    },
  };
}

export function getViewportDiagnosticPages(snapshot) {
  const header = (id, index) => `PREVIEW — Telegram viewport diagnostic · page ${index + 1}/${DIAGNOSTIC_PAGE_IDS.length} · ${id}`;
  const viewport = [
    header('viewport', 0),
    `window.inner: ${formatNumber(snapshot.window?.innerWidth)}x${formatNumber(snapshot.window?.innerHeight)} dpr=${formatNumber(snapshot.window?.devicePixelRatio)}`,
    `visualViewport: ${formatVisualViewport(snapshot.visualViewport)}`,
  ];
  const telegram = [
    header('telegram', 1),
    `telegram.viewportHeight: ${formatNumber(snapshot.telegram?.viewportHeight)}`,
    `telegram.viewportStableHeight: ${formatNumber(snapshot.telegram?.viewportStableHeight)}`,
    `telegram.safeAreaInsets: ${formatInsets(snapshot.telegram?.safeAreaInsets)}`,
    `telegram.contentSafeAreaInsets: ${formatInsets(snapshot.telegram?.contentSafeAreaInsets)}`,
  ];
  for (const name of TELEGRAM_VIEWPORT_CSS_VARIABLES) {
    telegram.push(`${name}: ${snapshot.cssVariables?.[name] || 'unavailable'}`);
  }
  const layout = [
    header('layout', 2),
    ...[
      ['documentElement', 'html'],
      ['root', '#root'],
      ['frame', '.telegram-frame'],
      ['container', '.app-container'],
      ['screenContent', '.screen-content'],
      ['tabBar', '.app-tab-bar'],
    ].map(([key, label]) => `rect ${label}: ${formatRect(snapshot.rects?.[key])}`),
    ...[
      ['root', '#root'],
      ['frame', '.telegram-frame'],
      ['tabBar', '.app-tab-bar'],
    ].map(([key, label]) => `position ${label}: ${formatPosition(snapshot.positions?.[key])}`),
  ];
  const overlapPage = [
    header('overlap', 3),
    `overlap #root × .telegram-frame: ${formatOverlap(snapshot.overlaps?.rootFrame)}`,
    `overlap .telegram-frame × .app-tab-bar: ${formatOverlap(snapshot.overlaps?.frameTabBar)}`,
    `overlap .screen-content × .app-tab-bar: ${formatOverlap(snapshot.overlaps?.screenContentTabBar)}`,
    `paint .app-tab-bar: ${formatPaint(snapshot.paints?.tabBar)}`,
    ...(snapshot.navItems || []).map((item) => [
      `paint nav[${item.index + 1}]: ${formatPaint(item.paint)}`,
      `hit nav[${item.index + 1}]: ${item.hitTarget || 'unavailable'}`,
    ]).flat(),
  ];
  return DIAGNOSTIC_PAGE_IDS.map((id, index) => ({
    id,
    index,
    lines: [viewport, telegram, layout, overlapPage][index],
  }));
}

export function formatViewportDiagnosticSnapshot(snapshot, selectedPage = null) {
  const pages = getViewportDiagnosticPages(snapshot);
  const index = pageIndex(selectedPage);
  if (index != null) return pages[index].lines.join('\n');
  return pages.map((page) => page.lines.join('\n')).join('\n');
}

export function mountViewportDiagnostic() {
  if (document.querySelector('[data-viewport-diagnostic]')) return;

  const panel = document.createElement('pre');
  panel.dataset.viewportDiagnostic = 'true';
  Object.assign(panel.style, {
    position: 'fixed',
    top: '8px',
    left: '8px',
    right: '8px',
    zIndex: '2147483647',
    maxHeight: 'calc(100vh - 16px)',
    margin: '0',
    padding: '8px',
    overflow: 'hidden',
    border: '1px solid rgba(43, 217, 254, 0.55)',
    borderRadius: '8px',
    background: 'rgba(4, 8, 14, 0.94)',
    color: '#B5F7FB',
    font: '10px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
    whiteSpace: 'pre-wrap',
    pointerEvents: 'none',
  });
  document.body.append(panel);

  const selectedPage = resolveViewportDiagnosticPage(window.location.search);
  let currentPage = selectedPage ?? 0;
  const update = () => {
    panel.textContent = formatViewportDiagnosticSnapshot(collectViewportDiagnosticSnapshot(), currentPage);
  };
  const listeners = [];
  const addListener = (target, type) => {
    if (typeof target?.addEventListener !== 'function') return;
    target.addEventListener(type, update, { passive: true });
    listeners.push(() => target.removeEventListener(type, update));
  };
  addListener(window, 'resize');
  addListener(window, 'orientationchange');
  addListener(window.visualViewport, 'resize');
  addListener(window.visualViewport, 'scroll');

  const webApp = window.Telegram?.WebApp;
  if (typeof webApp?.onEvent === 'function') {
    webApp.onEvent('viewportChanged', update);
    listeners.push(() => webApp.offEvent?.('viewportChanged', update));
  }

  const pageTimer = selectedPage == null && typeof window.setInterval === 'function'
    ? window.setInterval(() => {
      currentPage = (currentPage + 1) % DIAGNOSTIC_PAGE_IDS.length;
      update();
    }, DIAGNOSTIC_PAGE_INTERVAL_MS)
    : null;
  update();
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(update);
  return () => {
    if (pageTimer != null) window.clearInterval?.(pageTimer);
    listeners.forEach((remove) => remove());
    panel.remove();
  };
}
