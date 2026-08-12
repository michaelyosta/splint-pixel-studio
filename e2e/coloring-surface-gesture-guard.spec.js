import { test, expect } from '@playwright/test';
import {
  createLegacyColoring,
  createTiledColoring,
  openColoring,
  rawCssTexts,
  readComputedGuards,
  readTiledCamera,
  pickLoadedVisibleCell,
  selectionIsEmpty,
  waitForProgressAction,
  waitForTiledCellLoaded,
  waitForTiledReady,
  CELL,
} from './input-gesture-helpers.js';

function assertSurfaceGuards(style, { overscroll = true } = {}) {
  expect(style.webkitUserSelect).toBe('none');
  expect(style.touchAction).toBe('none');
  if (style.userSelect !== undefined && style.userSelect !== '') {
    expect(style.userSelect).toBe('none');
  }
  if (overscroll && style.overscrollBehavior !== undefined && style.overscrollBehavior !== '') {
    expect(style.overscrollBehavior).toBe('contain');
  }
}

async function aggressiveMouseDrag(page, box) {
  const startX = box.x + Math.max(16, box.width * 0.15);
  const startY = box.y + Math.max(16, box.height * 0.25);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= 14; step += 1) {
    const y = startY + (step % 2 === 0 ? 60 : -60);
    await page.mouse.move(startX + step * 14, y);
    await page.waitForTimeout(18);
  }
  await page.mouse.up();
}

async function scrollCatalog(page, { isMobile = false } = {}) {
  const screen = page.locator('.screen-content');
  await expect(screen).toBeVisible({ timeout: 15000 });
  await screen.evaluate((element) => element.scrollTo(0, 0));
  if (isMobile) {
    await expect.poll(async () => screen.evaluate((element) => (
      element.scrollHeight > element.clientHeight
    )), { timeout: 5000 }).toBe(true);
    await screen.evaluate((element) => {
      element.scrollTo({ top: Math.min(900, element.scrollHeight - element.clientHeight), behavior: 'auto' });
    });
  } else {
    await page.mouse.move(200, 300);
    await page.mouse.wheel(0, 900);
  }
  await expect.poll(async () => screen.evaluate((element) => element.scrollTop), {
    timeout: 5000,
  }).toBeGreaterThan(0);
}

test.describe('Coloring surface gesture guards', () => {
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

  test('classic surface suppresses selection, callout, image drag; guards stay scoped', async ({ page }) => {
    const coloring = await createLegacyColoring(page);
    await openColoring(page, coloring.id);
    await expect(page.locator('.coloring-canvas-viewport')).toBeVisible({ timeout: 15000 });

    const styles = await readComputedGuards(page, [
      '.coloring-canvas-viewport',
      '.coloring-canvas',
      'body',
    ]);
    assertSurfaceGuards(styles['.coloring-canvas-viewport']);
    assertSurfaceGuards(styles['.coloring-canvas'], { overscroll: false });
    const body = styles.body;
    if (body.userSelect !== undefined && body.userSelect !== '') {
      expect(body.userSelect).not.toBe('none');
    }

    const canvasCss = await rawCssTexts(page, '.coloring-canvas');
    expect(canvasCss.some((text) => text.includes('-webkit-touch-callout: none'))).toBe(true);
    expect(canvasCss.some((text) => text.includes('-webkit-user-drag: none'))).toBe(true);

    const box = await page.locator('.coloring-canvas-viewport').boundingBox();
    await aggressiveMouseDrag(page, box);
    expect(await selectionIsEmpty(page)).toBe(true);
  });

  test('tiled surface suppresses selection, keeps editable controls selectable; guards scoped', async ({ page }) => {
    const coloring = await createTiledColoring(page);
    await openColoring(page, coloring.id);
    await waitForTiledReady(page, coloring.id);

    const styles = await readComputedGuards(page, [
      '.progressive-grid-area',
      '.progressive-grid-area canvas:not(.progressive-grid-minimap-canvas)',
    ]);
    assertSurfaceGuards(styles['.progressive-grid-area']);
    assertSurfaceGuards(
      styles['.progressive-grid-area canvas:not(.progressive-grid-minimap-canvas)'],
      { overscroll: false },
    );

    const editable = await page.evaluate(() => {
      const area = document.querySelector('.progressive-grid-area');
      const textarea = document.createElement('textarea');
      const contenteditable = document.createElement('div');
      contenteditable.contentEditable = 'true';
      area.append(textarea, contenteditable);
      const result = {
        textarea: getComputedStyle(textarea),
        contenteditable: getComputedStyle(contenteditable),
      };
      const value = (style) => style.userSelect || style.webkitUserSelect;
      const output = {
        textarea: value(result.textarea),
        contenteditable: value(result.contenteditable),
      };
      textarea.remove();
      contenteditable.remove();
      return output;
    });
    expect(editable.textarea).not.toBe('none');
    expect(editable.contenteditable).not.toBe('none');

    const areaCss = await rawCssTexts(page, '.progressive-grid-area');
    expect(areaCss.some((text) => text.includes('-webkit-touch-callout: none'))).toBe(true);
    expect(areaCss.some((text) => text.includes('.progressive-grid-area img')
      && text.includes('-webkit-user-drag: none'))).toBe(true);

    const box = await page.locator('.progressive-grid-area').boundingBox();
    await aggressiveMouseDrag(page, box);
    expect(await selectionIsEmpty(page)).toBe(true);
  });

  test('normal catalog scroll remains available outside the player', async ({ page, isMobile }) => {
    await page.goto('/');
    await scrollCatalog(page, { isMobile });

    const coloring = await createLegacyColoring(page);
    await openColoring(page, coloring.id);
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 15000 });
    await page.locator('.back-button').click();
    await expect(page.locator('.screen-content')).toBeVisible({ timeout: 15000 });
    await scrollCatalog(page, { isMobile });
  });

  test('classic pointer capture stays on the canvas and paint commits progress', async ({ page }) => {
    const coloring = await createLegacyColoring(page);
    await openColoring(page, coloring.id);
    const canvas = page.locator('.coloring-canvas');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.coloring-canvas-viewport')).toHaveAttribute('data-interaction-disabled', 'false');

    await page.evaluate(() => {
      window.__surfacePointerId = null;
      document.querySelector('canvas.coloring-canvas').addEventListener('pointerdown', (event) => {
        window.__surfacePointerId = event.pointerId;
      }, { once: true });
    });
    const box = await page.locator('.coloring-canvas-viewport').boundingBox();
    const progress = waitForProgressAction(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const captured = await page.evaluate(() => {
      const canvasElement = document.querySelector('canvas.coloring-canvas');
      return window.__surfacePointerId != null
        && canvasElement.hasPointerCapture(window.__surfacePointerId);
    });
    expect(captured).toBe(true);
    await page.mouse.up();
    const response = await progress;
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.completed_cells).toBeGreaterThan(0);
  });

  test('tiled pointer capture is established on a loaded target and paint commits progress', async ({ page }) => {
    const coloring = await createTiledColoring(page);
    await openColoring(page, coloring.id, { metrics: true });
    await waitForTiledReady(page, coloring.id);
    const area = page.locator('.progressive-grid-area');
    const box = await area.boundingBox();
    const target = await pickLoadedVisibleCell(page, box);
    expect(target).not.toBeNull();
    await waitForTiledCellLoaded(page, target.x, target.y);

    const camera = await readTiledCamera(page);
    const point = {
      x: box.x + target.x * CELL * camera.zoom + camera.x + 16 * camera.zoom,
      y: box.y + target.y * CELL * camera.zoom + camera.y + 16 * camera.zoom,
    };

    await page.evaluate(() => {
      window.__tiledPointerId = null;
      document.querySelector('.progressive-grid-area').addEventListener('pointerdown', (event) => {
        window.__tiledPointerId = event.pointerId;
      }, { once: true });
    });
    const progress = waitForProgressAction(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    const captured = await page.evaluate(() => {
      const areaElement = document.querySelector('.progressive-grid-area');
      return window.__tiledPointerId != null
        && areaElement.hasPointerCapture(window.__tiledPointerId);
    });
    expect(captured).toBe(true);
    await page.mouse.up();
    const response = await progress;
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.completed_cells).toBeGreaterThan(0);
  });

  test('camera zoom still works on the tiled surface', async ({ page, isMobile }) => {
    test.skip(isMobile, 'wheel zoom is a desktop input');
    const coloring = await createTiledColoring(page);
    await openColoring(page, coloring.id);
    await waitForTiledReady(page, coloring.id);
    const area = page.locator('.progressive-grid-area');
    const zoomBefore = Number(await area.getAttribute('data-camera-zoom'));
    await area.hover();
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(300);
    const zoomAfter = Number(await area.getAttribute('data-camera-zoom'));
    expect(zoomAfter).toBeGreaterThan(zoomBefore);
  });
});
