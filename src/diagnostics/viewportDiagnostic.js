const CSS_VARIABLES = [
  '--tg-viewport-height',
  '--tg-viewport-stable-height',
  '--tg-safe-area-inset-bottom',
  '--tg-content-safe-area-inset-bottom',
];

function formatNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : 'unavailable';
}

function formatRect(element) {
  if (!element) return 'unavailable';
  const rect = element.getBoundingClientRect();
  return `x=${formatNumber(rect.x)} y=${formatNumber(rect.y)} width=${formatNumber(rect.width)} height=${formatNumber(rect.height)} top=${formatNumber(rect.top)} bottom=${formatNumber(rect.bottom)}`;
}

function render(panel) {
  const rootStyle = getComputedStyle(document.documentElement);
  const viewport = window.visualViewport;
  const values = CSS_VARIABLES.map((name) => `${name}: ${rootStyle.getPropertyValue(name).trim() || 'unavailable'}`);
  panel.textContent = [
    'PREVIEW — Telegram viewport diagnostic',
    `window.innerHeight: ${window.innerHeight}`,
    `visualViewport.height: ${viewport ? formatNumber(viewport.height) : 'unavailable'}`,
    ...values,
    `.telegram-frame: ${formatRect(document.querySelector('.telegram-frame'))}`,
    `.app-tab-bar: ${formatRect(document.querySelector('.app-tab-bar'))}`,
  ].join('\n');
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

  const update = () => render(panel);
  window.addEventListener('resize', update, { passive: true });
  window.addEventListener('orientationchange', update, { passive: true });
  window.visualViewport?.addEventListener('resize', update, { passive: true });
  window.visualViewport?.addEventListener('scroll', update, { passive: true });

  const webApp = window.Telegram?.WebApp;
  if (typeof webApp?.onEvent === 'function') webApp.onEvent('viewportChanged', update);

  update();
  requestAnimationFrame(update);
}
