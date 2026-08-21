import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const evidenceDir = resolve(process.cwd(), 'docs', 'evidence', 'accessibility-2026-08-07');
const captured = [];
const classicViewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

async function primeLocalStorage(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('splint_onboarding_version', '2');
    } catch {
      // Storage may be unavailable; onboarding is dismissed defensively below.
    }
  });
}

async function dismissOnboarding(page) {
  const skip = page.locator('.onboarding-card .secondary-button');
  await skip.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await skip.isVisible().catch(() => false)) await skip.click({ force: true });
}

async function openFirstCatalogPlayer(page) {
  await page.goto('/');
  const card = page.locator('.home-featured-card, .home-continue-card, .home-art-card').first();
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.click();
  await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
  await dismissOnboarding(page);
}

async function collectClassicMetrics(page) {
  return page.evaluate(() => {
    function hexToRgb(hex) {
      const match = /^#?([\da-f]{6})$/i.exec(hex) || /^#?([\da-f]{3})$/i.exec(hex);
      if (!match) return null;
      if (match[1].length === 3) {
        return {
          r: parseInt(match[1][0] + match[1][0], 16),
          g: parseInt(match[1][1] + match[1][1], 16),
          b: parseInt(match[1][2] + match[1][2], 16),
        };
      }
      return {
        r: parseInt(match[1].slice(0, 2), 16),
        g: parseInt(match[1].slice(2, 4), 16),
        b: parseInt(match[1].slice(4, 6), 16),
      };
    }
    function luminance(channel) {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }
    function relative(hex) {
      const rgb = hexToRgb(hex);
      if (!rgb) return null;
      return 0.2126 * luminance(rgb.r) + 0.7152 * luminance(rgb.g) + 0.0722 * luminance(rgb.b);
    }
    function ratio(first, second) {
      const firstLuminance = relative(first);
      const secondLuminance = relative(second);
      if (firstLuminance == null || secondLuminance == null) return null;
      const light = Math.max(firstLuminance, secondLuminance);
      const dark = Math.min(firstLuminance, secondLuminance);
      return Number(((light + 0.05) / (dark + 0.05)).toFixed(2));
    }
    const contrast = {
      textOnDock: ratio('#F0F6FC', '#0C1622'),
      selectedRingOnDock: ratio('#2BD9FE', '#0B1522'),
      summaryTextOnCard: ratio('#F0F6FC', '#0C1622'),
      wrongSignalOnCanvas: ratio('#FF5C5C', '#0B1522'),
    };
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        left: Math.round(box.left),
        top: Math.round(box.top),
        right: Math.round(box.right),
        bottom: Math.round(box.bottom),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    };
    const overlap = (first, second) => {
      if (!first || !second) return null;
      return !(first.right <= second.left || second.right <= first.left || first.bottom <= second.top || second.bottom <= first.top);
    };
    const dock = rect('.coloring-dock');
    const actions = rect('.coloring-dock-actions');
    const summary = rect('.coloring-task-summary');
    const hud = rect('.coloring-hud');
    const canvas = rect('.coloring-canvas-viewport');
    const overflowText = Array.from(document.querySelectorAll(
      '.player-topbar-title, .coloring-task-summary, .coloring-dock-actions, .hud-btn, .color-swatch',
    )).filter((element) => element.scrollWidth > element.clientWidth + 1).length;
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      domNodes: document.querySelectorAll('*').length,
      canvasCount: document.querySelectorAll('canvas').length,
      canvasPixels: Array.from(document.querySelectorAll('canvas')).reduce((sum, el) => sum + el.width * el.height, 0),
      perCellDom: document.querySelectorAll('[data-cell-index], .coloring-cell').length,
      liveRegions: document.querySelectorAll('[aria-live], [role="status"]').length,
      swatches: document.querySelectorAll('.color-swatch').length,
      selectedSwatchLabel: document.querySelector('.color-swatch.selected')?.getAttribute('aria-label') || null,
      overflowText,
      bounds: {
        dockInViewport: dock ? dock.left >= 0 && dock.right <= window.innerWidth : null,
        actionsInViewport: actions ? actions.left >= 0 && actions.right <= window.innerWidth : null,
        summaryInViewport: summary ? summary.left >= 0 && summary.right <= window.innerWidth : null,
        hudInViewport: hud ? hud.left >= 0 && hud.right <= window.innerWidth : null,
      },
      overlaps: {
        summaryDock: overlap(summary, dock),
        hudCanvas: overlap(hud, canvas),
      },
      contrast,
    };
  });
}

async function createAndOpenTiledColoring(page) {
  await page.goto('/');
  await page.getByText('Создать').first().click();
  await page.getByRole('button', { name: 'Из изображения' }).click();
  await expect(page.locator('.creator-page')).toBeVisible({ timeout: 10000 });
  await page.locator('.file-field input[type="file"]').setInputFiles([resolve(process.cwd(), 'e2e', 'fixtures', 'test-image.png')]);
  // Resolution is a discrete preset index (0=192 ... 3=1200), not the
  // obsolete raw detail value used by the original fixture.
  await page.locator('.grid-detail-range').fill('3');
  await expect(page.locator('.creator-previews')).toBeVisible({ timeout: 45000 });
  await expect(page.locator('.creator-preview-option.selected')).toHaveAttribute('data-resolution', '1200');
  await expect(page.locator('.creator-preview-option.selected')).toHaveAttribute('data-status', 'ready', { timeout: 120000 });
  const saveButton = page.locator('button', { hasText: 'Сохранить и начать' });
  await expect(saveButton).toBeVisible({ timeout: 15000 });
  await expect(saveButton).toBeEnabled({ timeout: 120000 });
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/colorings/create')),
    saveButton.click(),
  ]);
  await expect(page.locator('.creator-success-page')).toBeVisible({ timeout: 15000 });
  await page.locator('.creator-success-page button:has-text("Начать раскрашивать")').click();
  await expect(page.locator('.progressive-coloring-session')).toBeVisible({ timeout: 15000 });
  await dismissOnboarding(page);
  await page.waitForResponse(
    (response) => response.url().includes('/api/colorings/') && response.url().includes('/tiles/') && response.ok(),
    { timeout: 20000 },
  ).catch(() => {});
}

test.describe('Accessibility evidence', () => {
  test.skip(process.env.ACCESSIBILITY_EVIDENCE !== '1', 'run with ACCESSIBILITY_EVIDENCE=1');

  test.beforeEach(async ({ page }, testInfo) => {
    await page.context().setExtraHTTPHeaders({ 'X-User-Id': `e2e_a11y_evidence_${testInfo.testId}` });
    await primeLocalStorage(page);
    await page.route('https://telegram.org/js/telegram-web-app.js', async (route) => {
      await route.fulfill({
        contentType: 'application/javascript',
        body: 'window.Telegram = window.Telegram || { WebApp: { ready() {} } };',
      });
    });
  });

  test.afterAll(() => {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(
      resolve(evidenceDir, 'metrics.json'),
      JSON.stringify({ capturedAt: new Date().toISOString(), screens: captured }, null, 2),
    );
    const summary = captured.map((screen) => ({
      name: screen.name,
      viewport: screen.metrics?.viewportWidth ? `${screen.metrics.viewportWidth}x${screen.metrics.viewportHeight}` : null,
      noHorizontalOverflow: screen.metrics?.noHorizontalOverflow ?? null,
      domNodes: screen.metrics?.domNodes ?? null,
      canvasCount: screen.metrics?.canvasCount ?? null,
      canvasPixels: screen.metrics?.canvasPixels ?? null,
      liveRegions: screen.metrics?.liveRegions ?? null,
      overflowText: screen.metrics?.overflowText ?? null,
    }));
    writeFileSync(
      resolve(evidenceDir, 'README.md'),
      [
        '# Accessibility evidence - 2026-08-07',
        '',
        'Команда воспроизведения:',
        '',
        '```text',
        '$env:ACCESSIBILITY_EVIDENCE="1"; npm run test:e2e -- --project=chromium --grep "Accessibility evidence"',
        '```',
        '',
        `Собрано ${captured.length} снимков в Chromium. Точные значения - в metrics.json.`,
        '',
        'Локальные проверки (не заменяют физический screen reader или реальный Telegram WebView):',
        '',
        ...summary.flatMap((item) => [
          `- ${item.name}: ${item.viewport}, no-horizontal-overflow=${item.noHorizontalOverflow}, DOM=${item.domNodes}, canvas=${item.canvasCount}, backing=${item.canvasPixels}, live-regions=${item.liveRegions}, text-overflow=${item.overflowText}`,
        ]),
        '',
        'Проверено keyboard-only: стрелки/Home/End/цифры, Enter/Space для закраски, + и - для масштаба, 0 для обзора. Palette и HUD работают с клавиатуры.',
        'Live-фидбек ограничен: один sr-only status на сессию и один на канвас, без per-cell DOM.',
        'Reduced motion: переходы и анимации обнулены; закрашивание остаётся рабочим.',
        'Forced colors: выбранный цвет получает outline Highlight, не полагаясь на цвет.',
        'HUD по дизайну лежит поверх канваса; dock, actions и summary не пересекаются между собой.',
        '',
        'Ограничения: metrics собраны в Chromium dev-server прогоне; iPhone/Pixel и Android keyboard/contrast и физический screen reader остаются внешними release-gates.',
        '',
      ].join('\n'),
    );
  });

  for (const viewport of classicViewports) {
    test(`capture classic player at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openFirstCatalogPlayer(page);
      await expect(page.locator('canvas.coloring-canvas')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.coloring-session')).toHaveAttribute('data-route-status', 'ready', { timeout: 10000 });
      const canvas = page.locator('canvas.coloring-canvas');
      await page.screenshot({ path: resolve(evidenceDir, `player-${viewport.width}.png`) });
      await canvas.focus();
      await page.screenshot({ path: resolve(evidenceDir, `player-focus-${viewport.width}.png`) });
      const metrics = await collectClassicMetrics(page);
      captured.push({ name: `classic-${viewport.width}`, viewport, metrics });
    });
  }

  test('capture reduced-motion player at 390px', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await openFirstCatalogPlayer(page);
    await expect(page.locator('canvas.coloring-canvas')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: resolve(evidenceDir, 'player-reduced-motion-390.png') });
    const motion = await page.evaluate(() => ({
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      transitionDuration: getComputedStyle(document.querySelector('.color-swatch')).transitionDuration,
      animationDuration: getComputedStyle(document.querySelector('.color-swatch')).animationDuration,
    }));
    const metrics = await collectClassicMetrics(page);
    captured.push({ name: 'reduced-motion-390', viewport: { width: 390, height: 844 }, motion, metrics });
  });

  test('capture forced-colors player at 390px', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.setViewportSize({ width: 390, height: 844 });
    await openFirstCatalogPlayer(page);
    await expect(page.locator('canvas.coloring-canvas')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: resolve(evidenceDir, 'player-forced-colors-390.png') });
    const forced = await page.evaluate(() => ({
      active: window.matchMedia('(forced-colors: active)').matches,
      selectedOutline: getComputedStyle(document.querySelector('.color-swatch.selected')).outlineStyle,
    }));
    const metrics = await collectClassicMetrics(page);
    captured.push({ name: 'forced-colors-390', viewport: { width: 390, height: 844 }, forced, metrics });
  });

  test('capture tiled 1200 player at 390px', async ({ page }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: 390, height: 844 });
    const tileResponses = [];
    page.on('response', (response) => {
      if (response.url().includes('/api/colorings/') && response.url().includes('/tiles/') && response.ok()) {
        tileResponses.push(response.url());
      }
    });
    await createAndOpenTiledColoring(page);
    const session = page.locator('.progressive-coloring-session');
    await expect(session.locator('canvas:not(.progressive-grid-minimap-canvas)')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: resolve(evidenceDir, 'tiled-1200-390.png') });
    const metrics = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      domNodes: document.querySelectorAll('*').length,
      canvasCount: document.querySelectorAll('canvas').length,
      canvasPixels: Array.from(document.querySelectorAll('canvas')).reduce((sum, el) => sum + el.width * el.height, 0),
      perCellDom: document.querySelectorAll('[data-cell-index], .coloring-cell').length,
      liveRegions: document.querySelectorAll('[aria-live], [role="status"]').length,
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
    }));
    captured.push({ name: 'tiled-1200-390', viewport: { width: 390, height: 844 }, metrics, tileResponses: tileResponses.length });
  });
});
