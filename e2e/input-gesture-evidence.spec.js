import { test, expect } from '@playwright/test';
import {
  CELL,
  createLegacyColoring,
  createTiledColoring,
  createTouchSession,
  focusLegacyCell,
  openColoring,
  pickLoadedVisibleCell,
  readTiledCamera,
  sendTouch,
  waitForProgressAction,
  waitForTiledCellLoaded,
  waitForTiledReady,
} from './input-gesture-helpers.js';

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function tiledTargetPoint(page) {
  const box = await page.locator('.progressive-grid-area').boundingBox();
  const target = await pickLoadedVisibleCell(page, box);
  expect(target).not.toBeNull();
  await waitForTiledCellLoaded(page, target.x, target.y);
  const camera = await readTiledCamera(page);
  return {
    target,
    box,
    point: {
      x: box.x + target.x * CELL * camera.zoom + camera.x + 16 * camera.zoom,
      y: box.y + target.y * CELL * camera.zoom + camera.y + 16 * camera.zoom,
    },
  };
}

test.describe('Input gesture evidence', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await page.route('https://telegram.org/js/telegram-web-app.js', async (route) => {
      await route.fulfill({
        contentType: 'application/javascript',
        body: 'window.Telegram = window.Telegram || { WebApp: { ready() {} } };',
      });
    });
    await page.context().setExtraHTTPHeaders({ 'X-User-Id': `e2e_${testInfo.testId}` });
    await page.addInitScript(() => {
      try {
        localStorage.setItem('splint_onboarding_version', '2');
      } catch {
        // Local storage can be unavailable in strict privacy contexts.
      }
    });
  });

  test('classic keyboard paint commits server progress', async ({ page }) => {
    const coloring = await createLegacyColoring(page);
    await openColoring(page, coloring.id);
    const canvas = await focusLegacyCell(page, 0);
    const progress = waitForProgressAction(page);
    await canvas.press('Enter');
    const response = await progress;
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.completed_cells).toBeGreaterThan(0);
  });

  test('tiled real touch paint commits server progress and captures the pointer', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'CDP touch evidence is Chromium-only');
    const coloring = await createTiledColoring(page);
    await openColoring(page, coloring.id, { metrics: true });
    await waitForTiledReady(page, coloring.id);
    const { point } = await tiledTargetPoint(page);
    const session = await createTouchSession(page);

    await page.evaluate(() => {
      window.__touchPointerId = null;
      document.querySelector('.progressive-grid-area').addEventListener('pointerdown', (event) => {
        window.__touchPointerId = event.pointerId;
      }, { once: true });
    });
    const progress = waitForProgressAction(page);
    await sendTouch(session, 'touchStart', [{ x: point.x, y: point.y }]);
    const captured = await page.evaluate(() => {
      const area = document.querySelector('.progressive-grid-area');
      return window.__touchPointerId != null
        && area.hasPointerCapture(window.__touchPointerId);
    });
    expect(captured).toBe(true);
    await sendTouch(session, 'touchEnd', []);
    const response = await progress;
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.completed_cells).toBeGreaterThan(0);
    await session.detach();
  });

  test('tiled two-pointer pinch changes zoom without page errors', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'two-finger CDP input is Chromium-only');
    const errors = watchErrors(page);
    const coloring = await createTiledColoring(page);
    await openColoring(page, coloring.id, { metrics: true });
    await waitForTiledReady(page, coloring.id);
    const box = await page.locator('.progressive-grid-area').boundingBox();
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const zoomBefore = (await readTiledCamera(page)).zoom;
    const session = await createTouchSession(page);

    await sendTouch(session, 'touchStart', [
      { x: centerX - 40, y: centerY },
      { x: centerX + 40, y: centerY },
    ]);
    await sendTouch(session, 'touchMove', [
      { x: centerX - 95, y: centerY - 12 },
      { x: centerX + 95, y: centerY + 12 },
    ]);
    await sendTouch(session, 'touchEnd', []);
    await page.waitForTimeout(300);
    const zoomAfter = (await readTiledCamera(page)).zoom;
    expect(zoomAfter).toBeGreaterThan(zoomBefore);
    expect(errors).toEqual([]);
    await session.detach();
  });

  test('pointercancel does not leave a stuck stroke; next touch still commits', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'CDP touchCancel evidence is Chromium-only');
    const errors = watchErrors(page);
    const coloring = await createTiledColoring(page);
    await openColoring(page, coloring.id, { metrics: true });
    await waitForTiledReady(page, coloring.id);
    const first = await tiledTargetPoint(page);
    const session = await createTouchSession(page);

    const firstProgress = waitForProgressAction(page);
    await sendTouch(session, 'touchStart', [{ x: first.point.x, y: first.point.y }]);
    await sendTouch(session, 'touchCancel', []);
    const firstResponse = await firstProgress;
    expect(firstResponse.status()).toBe(200);
    const firstBody = await firstResponse.json();
    expect(firstBody.completed_cells).toBeGreaterThan(0);

    const secondTarget = await pickLoadedVisibleCell(page, first.box);
    expect(secondTarget).not.toBeNull();
    await waitForTiledCellLoaded(page, secondTarget.x, secondTarget.y);
    const camera = await readTiledCamera(page);
    const secondPoint = {
      x: first.box.x + secondTarget.x * CELL * camera.zoom + camera.x + 16 * camera.zoom,
      y: first.box.y + secondTarget.y * CELL * camera.zoom + camera.y + 16 * camera.zoom,
    };

    const secondProgress = waitForProgressAction(page);
    await sendTouch(session, 'touchStart', [{ x: secondPoint.x, y: secondPoint.y }]);
    await sendTouch(session, 'touchEnd', []);
    const secondResponse = await secondProgress;
    expect(secondResponse.status()).toBe(200);
    const secondBody = await secondResponse.json();
    expect(secondBody.completed_cells).toBeGreaterThan(firstBody.completed_cells);
    expect(errors).toEqual([]);
    await session.detach();
  });

  for (const width of [360, 390, 430]) {
    test(`tiled surface fits the ${width}px viewport`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      const coloring = await createTiledColoring(page);
      await openColoring(page, coloring.id);
      await waitForTiledReady(page, coloring.id);
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
      const box = await page.locator('.progressive-grid-area').boundingBox();
      expect(box.width).toBeLessThanOrEqual(width + 1);
    });
  }
});
