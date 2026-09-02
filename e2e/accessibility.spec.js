import { test, expect } from '@playwright/test';

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
  await expect(page.locator('.onboarding-overlay')).toHaveCount(0).catch(() => {});
}

async function openFirstCatalogPlayer(page) {
  await page.goto('/');
  const card = page.locator('.catalog-art-open').first();
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.click();
  await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
  await dismissOnboarding(page);
}

async function waitForGuidedCanvas(page) {
  const canvas = page.locator('canvas.coloring-canvas');
  await expect(canvas).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.coloring-session')).toHaveAttribute('data-route-status', 'ready', { timeout: 10000 });
  await expect.poll(async () => (
    (await canvas.getAttribute('data-active-work-cells').catch(() => '')).split(',').filter(Boolean).length > 0
  ), { timeout: 5000 }).toBe(true);
  return canvas;
}

async function tapActiveWorkCell(page) {
  const canvas = await waitForGuidedCanvas(page);
  const activeCells = (await canvas.getAttribute('data-active-work-cells')).split(',').map(Number);
  const templateWidth = Number(await canvas.getAttribute('data-template-width'));
  const viewport = page.locator('.coloring-canvas-viewport');
  const camera = {
    x: Number(await viewport.getAttribute('data-camera-x')),
    y: Number(await viewport.getAttribute('data-camera-y')),
    zoom: Number(await viewport.getAttribute('data-camera-zoom')),
  };
  const index = activeCells[0];
  await canvas.tap({
    position: {
      x: camera.x + ((index % templateWidth) + 0.5) * 32 * camera.zoom,
      y: camera.y + (Math.floor(index / templateWidth) + 0.5) * 32 * camera.zoom,
    },
  });
}

test.describe('Client accessibility release gates', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await page.context().setExtraHTTPHeaders({ 'X-User-Id': `e2e_a11y_${testInfo.testId}` });
    await primeLocalStorage(page);
    await page.route('https://telegram.org/js/telegram-web-app.js', async (route) => {
      await route.fulfill({
        contentType: 'application/javascript',
        body: 'window.Telegram = window.Telegram || { WebApp: { ready() {} } };',
      });
    });
  });

  test('player exposes one canvas, radio palette, and bounded live regions', async ({ page, isMobile }) => {
    await page.setViewportSize({ width: isMobile ? 390 : 430, height: isMobile ? 844 : 932 });
    await openFirstCatalogPlayer(page);
    await waitForGuidedCanvas(page);

    const canvas = page.locator('canvas.coloring-canvas');
    await expect(canvas).toHaveCount(1);
    await expect(canvas).toHaveAttribute('aria-label', /Поле раскраски/);
    await expect(canvas).toHaveAttribute('aria-describedby', /.+/);
    await expect(canvas).toHaveAttribute('tabindex', '0');
    await expect(page.locator('canvas[role="application"]')).toHaveCount(1);

    const palette = page.getByRole('radiogroup', { name: 'Палитра цветов' });
    await expect(palette).toBeVisible();
    const swatches = palette.getByRole('radio');
    await expect(swatches).toHaveCount(await palette.locator('.color-swatch').count());
    await expect(palette.getByRole('radio', { checked: true })).toHaveCount(1);

    const bounds = await page.evaluate(() => ({
      perCellDom: document.querySelectorAll('[data-cell-index], .coloring-cell').length,
      canvasCount: document.querySelectorAll('canvas').length,
      liveRegions: document.querySelectorAll('[aria-live], [role="status"]').length,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    }));
    expect(bounds.perCellDom).toBe(0);
    expect(bounds.canvasCount).toBe(1);
    expect(bounds.liveRegions).toBeLessThanOrEqual(8);
    expect(bounds.horizontalOverflow).toBe(false);
  });

  test('keyboard-only can move cursor, zoom, and paint a guided cell', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFirstCatalogPlayer(page);
    const canvas = await waitForGuidedCanvas(page);
    const activeCells = (await canvas.getAttribute('data-active-work-cells')).split(',').map(Number);
    const firstActive = activeCells[0];
    await canvas.focus();
    await expect(canvas).toBeFocused();
    await expect(canvas).toHaveAttribute('data-keyboard-cell', String(firstActive));

    const progressAction = page.waitForResponse(
      (response) => response.url().includes('/progress/actions') && response.request().method() === 'POST',
    );
    await page.keyboard.press('Enter');
    const saved = await progressAction;
    expect(saved.status()).toBe(200);
    expect((await saved.json()).completed_cells).toBeGreaterThan(0);

    const session = page.locator('.coloring-session');
    await expect(session).toHaveAttribute('data-route-status', 'ready', { timeout: 5000 });
    await canvas.focus();
    await page.keyboard.press('Home');
    await expect(canvas).toHaveAttribute('data-keyboard-cell', '0');
    await page.keyboard.press('ArrowRight');
    await expect(canvas).toHaveAttribute('data-keyboard-cell', '1');

    const viewport = page.locator('.coloring-canvas-viewport');
    const zoomBefore = Number(await viewport.getAttribute('data-camera-zoom'));
    await page.keyboard.press('+');
    await expect.poll(async () => Number(await viewport.getAttribute('data-camera-zoom')), { timeout: 3000 })
      .toBeGreaterThan(zoomBefore);
    await page.keyboard.press('-');
    await expect.poll(async () => Number(await viewport.getAttribute('data-camera-zoom')), { timeout: 3000 })
      .toBeLessThan(zoomBefore * 1.25);
  });

  test('palette is keyboard-operable and selection is announced via state labels', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFirstCatalogPlayer(page);
    await waitForGuidedCanvas(page);

    const palette = page.getByRole('radiogroup', { name: 'Палитра цветов' });
    const secondSwatch = palette.getByRole('radio').nth(1);
    await secondSwatch.focus();
    await expect(secondSwatch).toBeFocused();
    await page.keyboard.press('Enter');
    const session = page.locator('.coloring-session');
    await expect(session).toHaveAttribute('data-route-status', 'focusingTarget');
    await expect(session).toHaveAttribute('data-route-status', 'ready', { timeout: 5000 });
    await expect(palette.getByRole('radio', { checked: true })).toHaveCount(1);
    const selectedLabel = await palette.getByRole('radio', { checked: true }).getAttribute('aria-label');
    expect(selectedLabel).toMatch(/выбран/);
    await expect(palette.getByRole('radio', { checked: true })).toHaveAttribute('data-state', 'selected');
  });

  test('touch input paints on mobile profiles', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Touch tap is exercised on mobile projects');
    await page.setViewportSize({ width: 390, height: 844 });
    await openFirstCatalogPlayer(page);
    const canvas = await waitForGuidedCanvas(page);
    const progressAction = page.waitForResponse(
      (response) => response.url().includes('/progress/actions') && response.request().method() === 'POST',
    );
    await tapActiveWorkCell(page);
    await expect(canvas).toBeVisible();
    const saved = await progressAction;
    expect(saved.status()).toBe(200);
    expect((await saved.json()).completed_cells).toBeGreaterThan(0);
  });

  test('HUD controls are keyboard-operable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFirstCatalogPlayer(page);
    await waitForGuidedCanvas(page);

    const session = page.locator('.coloring-session');
    const nextButton = page.getByRole('button', { name: 'Следующий участок' });
    await nextButton.focus();
    await expect(nextButton).toBeFocused();
    await nextButton.press('Enter');
    await expect(session).toHaveAttribute('data-route-status', 'focusingTarget');
    await expect(session).toHaveAttribute('data-route-status', 'ready', { timeout: 3000 });

    const overviewButton = page.getByRole('button', { name: 'Показать всю картину' });
    await overviewButton.focus();
    await overviewButton.press('Enter');
    await expect(session).toHaveAttribute('data-route-status', 'freeExploration');
    await expect(page.getByRole('button', { name: 'Вернуться к текущему участку' })).toBeVisible();
  });

  test('reduced motion does not disable painting or controls', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await openFirstCatalogPlayer(page);
    const canvas = await waitForGuidedCanvas(page);

    const motion = await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('.color-swatch'));
      return {
        reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        transitionDuration: style.transitionDuration,
        animationDuration: style.animationDuration,
      };
    });
    expect(motion.reduced).toBe(true);
    expect(parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(0.02);
    expect(parseFloat(motion.animationDuration)).toBeLessThanOrEqual(0.02);

    await canvas.focus();
    const progressAction = page.waitForResponse(
      (response) => response.url().includes('/progress/actions') && response.request().method() === 'POST',
    );
    await page.keyboard.press('Enter');
    const saved = await progressAction;
    expect(saved.status()).toBe(200);
    expect((await saved.json()).completed_cells).toBeGreaterThan(0);
  });

  test('forced-colors keeps selected state visible without color', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'forced-colors emulation is Chromium-only in Playwright');
    await page.emulateMedia({ forcedColors: 'active' });
    await page.setViewportSize({ width: 390, height: 844 });
    await openFirstCatalogPlayer(page);
    await waitForGuidedCanvas(page);

    expect(await page.evaluate(() => window.matchMedia('(forced-colors: active)').matches)).toBe(true);
    const selectedStyle = await page.locator('.color-swatch.selected').evaluate((element) => {
      const style = getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    expect(selectedStyle.outlineStyle).not.toBe('none');
    expect(parseFloat(selectedStyle.outlineWidth)).toBeGreaterThan(0);

    const palette = page.getByRole('radiogroup', { name: 'Палитра цветов' });
    await palette.getByRole('radio').nth(1).focus();
    await page.keyboard.press('Enter');
    await expect(palette.getByRole('radio', { checked: true })).toHaveCount(1);
  });

  test('mobile widths stay within viewport without text overflow', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openFirstCatalogPlayer(page);
    await waitForGuidedCanvas(page);
    await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());
    await page.waitForTimeout(100);
    const metrics = await page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      };
      const overflowDetails = Array.from(document.querySelectorAll(
        '.coloring-task-summary, .coloring-dock-actions, .hud-btn, .color-swatch',
      )).filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => ({
        selector: `.${element.className.split(/\s+/).filter(Boolean).join('.')}`,
        text: element.textContent?.trim(),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
      const palette = rect('.coloring-dock');
      const actions = rect('.coloring-dock-actions');
      const summary = rect('.coloring-task-summary');
      const hud = rect('.coloring-hud');
      return {
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        overflowText: overflowDetails.length,
        overflowDetails,
        paletteInViewport: palette ? palette.left >= 0 && palette.right <= window.innerWidth : null,
        actionsInViewport: actions ? actions.left >= 0 && actions.right <= window.innerWidth : null,
        summaryInViewport: summary ? summary.left >= 0 && summary.right <= window.innerWidth : null,
        hudInViewport: hud ? hud.left >= 0 && hud.right <= window.innerWidth : null,
      };
    });
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
    expect(metrics.overflowDetails).toEqual([]);
    expect(metrics.paletteInViewport).toBe(true);
    expect(metrics.actionsInViewport).toBe(true);
    expect(metrics.summaryInViewport).toBe(true);
    expect(metrics.hudInViewport).toBe(true);
  });
});
