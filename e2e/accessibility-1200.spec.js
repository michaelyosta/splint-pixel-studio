import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(__dirname, 'fixtures', 'test-image.png');

async function dismissOnboarding(page) {
  const skip = page.locator('.onboarding-card .secondary-button');
  await skip.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await skip.isVisible().catch(() => false)) await skip.click({ force: true });
}

async function createAndOpenTiledColoring(page) {
  await page.goto('/');
  await page.getByText('Создать').first().click();
  await page.getByRole('button', { name: 'Из изображения' }).click();
  await expect(page.locator('.creator-page')).toBeVisible({ timeout: 10000 });
  await page.locator('.file-field input[type="file"]').setInputFiles([fixture]);
  await page.locator('.grid-detail-range').fill('18');
  await expect(page.locator('button.create-button').first()).toBeEnabled({ timeout: 15000 });
  await page.locator('button.create-button').first().click();
  await expect(page.locator('.creator-previews')).toBeVisible({ timeout: 45000 });
  const saveButton = page.locator('button', { hasText: 'Сохранить и начать' });
  await expect(saveButton).toBeVisible({ timeout: 15000 });
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/colorings/create')),
    saveButton.click(),
  ]);
  expect(response.status()).toBe(201);
  const created = await response.json();
  await expect(page.locator('.creator-success-page')).toBeVisible({ timeout: 15000 });
  await page.locator('.creator-success-page button:has-text("Начать раскрашивать")').click();
  await expect(page.locator('.progressive-coloring-session')).toBeVisible({ timeout: 15000 });
  await dismissOnboarding(page);
  return created.id;
}

async function waitForFirstTile(page) {
  await page.waitForResponse(
    (response) => response.url().includes('/api/colorings/') && response.url().includes('/tiles/') && response.ok(),
    { timeout: 20000 },
  ).catch(() => {});
  await expect(page.locator('.progressive-grid-area canvas').first()).toBeVisible({ timeout: 10000 });
}

test.describe('1200x1200 accessibility and bounded-input gates', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await page.context().setExtraHTTPHeaders({ 'X-User-Id': `e2e_a11y_1200_${testInfo.testId}` });
    await page.addInitScript(() => {
      try {
        localStorage.setItem('splint_onboarding_version', '2');
      } catch {
        // Storage may be unavailable.
      }
    });
    await page.route('https://telegram.org/js/telegram-web-app.js', async (route) => {
      await route.fulfill({
        contentType: 'application/javascript',
        body: 'window.Telegram = window.Telegram || { WebApp: { ready() {} } };',
      });
    });
  });

  test('tiled 1200 player keeps one canvas, bounded DOM, keyboard paint, and zone navigation', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', '1200 creator compute is not e2e-practical on WebKit emulation');
    await page.setViewportSize({ width: 390, height: 844 });
    const isChromium = browserName === 'chromium';
    const touchSession = isChromium ? await page.context().newCDPSession(page) : null;
    if (touchSession) await touchSession.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const id = await createAndOpenTiledColoring(page);
    await waitForFirstTile(page);
    const tiledMetrics = await page.evaluate(() => window.__splintTiledMetrics || null);
    expect(tiledMetrics).toBeTruthy();
    expect(tiledMetrics.firstTileAt).toBeGreaterThan(0);
    expect(tiledMetrics.templateId).toBe(id);
    if (process.env.VITE_SHOW_COLORING_DIAGNOSTICS === 'true') {
      await expect(page.locator('.progressive-grid-diagnostics')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.progressive-grid-diagnostics')).toContainText('fps');
    }

    const session = page.locator('.progressive-coloring-session');
    const canvases = session.locator('canvas');
    const canvas = canvases.first();
    await expect(canvases).toHaveCount(2);
    await expect(canvas).toHaveCount(1);
    await expect(canvas).toHaveAttribute('role', 'application');
    await expect(canvas).toHaveAttribute('aria-label', /Поле раскраски/);
    await expect(canvas).toHaveAttribute('tabindex', '0');

    const bounds = await page.evaluate(() => ({
      perCellDom: document.querySelectorAll('[data-cell-index], .coloring-cell').length,
      canvasCount: document.querySelectorAll('canvas').length,
      domNodes: document.querySelectorAll('*').length,
      liveRegions: document.querySelectorAll('[aria-live], [role="status"]').length,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      backingPixels: Array.from(document.querySelectorAll('canvas')).reduce((sum, el) => sum + el.width * el.height, 0),
    }));
    expect(bounds.perCellDom).toBe(0);
    expect(bounds.canvasCount).toBe(2);
    expect(bounds.domNodes).toBeLessThan(400);
    expect(bounds.liveRegions).toBeLessThanOrEqual(8);
    expect(bounds.horizontalOverflow).toBe(false);
    expect(bounds.backingPixels).toBeLessThan(1600000);

    const palette = page.getByRole('radiogroup', { name: 'Палитра цветов' });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('radio', { checked: true })).toHaveCount(1);

    const gridArea = page.locator('.progressive-grid-area');
    const cameraBefore = {
      x: Number(await gridArea.getAttribute('data-camera-x')),
      y: Number(await gridArea.getAttribute('data-camera-y')),
      zoom: Number(await gridArea.getAttribute('data-camera-zoom')),
    };
    await canvas.focus();
    const gridWidth = Number(await session.getAttribute('data-grid-width'));
    const cursorIndex = Number(await canvas.getAttribute('data-keyboard-cell'));
    const cursorX = cursorIndex % gridWidth;
    const cursorY = Math.floor(cursorIndex / gridWidth);
    const cursorTileX = Math.floor(cursorX / 32);
    const cursorTileY = Math.floor(cursorY / 32);
    const cursorTileResponse = await page.request.get(`/api/colorings/${id}/tiles/${cursorTileX}/${cursorTileY}`);
    expect(cursorTileResponse.ok()).toBe(true);
    const cursorTile = await cursorTileResponse.json();
    const targetColor = Number(cursorTile.cells[(cursorY % 32) * 32 + (cursorX % 32)]);
    await palette.getByRole('radio').nth(targetColor).focus();
    await page.keyboard.press('Enter');
    await expect(palette.getByRole('radio', { checked: true })).toHaveAttribute('data-state', 'selected');
    await canvas.focus();
    // Selecting a color at overview can make the smart guide move the camera
    // to that color's zone; repoint the keyboard cursor at the new center and
    // select its color before painting.
    const focusedCursorIndex = Number(await canvas.getAttribute('data-keyboard-cell'));
    const focusedCursorX = focusedCursorIndex % gridWidth;
    const focusedCursorY = Math.floor(focusedCursorIndex / gridWidth);
    const focusedTileX = Math.floor(focusedCursorX / 32);
    const focusedTileY = Math.floor(focusedCursorY / 32);
    const focusedTileResponse = await page.request.get(`/api/colorings/${id}/tiles/${focusedTileX}/${focusedTileY}`);
    const focusedTile = await focusedTileResponse.json();
    const focusedTargetColor = Number(focusedTile.cells[(focusedCursorY % 32) * 32 + (focusedCursorX % 32)]);
    if (focusedTargetColor !== targetColor) {
      await palette.getByRole('radio').nth(focusedTargetColor).focus();
      await page.keyboard.press('Enter');
      await expect(palette.getByRole('radio', { checked: true })).toHaveAttribute('data-state', 'selected');
      await canvas.focus();
    }
    const progressAction = page.waitForResponse(
      (response) => response.url().includes('/progress/actions') && response.request().method() === 'POST',
    );
    await page.keyboard.press('Enter');
    const saved = await progressAction;
    expect(saved.status()).toBe(200);
    expect((await saved.json()).completed_cells).toBeGreaterThan(0);

    await canvas.focus();
    await page.keyboard.press('2');
    await expect(session.locator('.progressive-grid-minimap')).toHaveAttribute('data-zone-count', '16');
    await expect(session.locator('.progressive-grid-minimap')).toHaveAttribute('data-active-zone', '1');
    await expect(session.locator('.progressive-grid-minimap-label')).toContainText('зона 2');
    await expect(session.locator('.progressive-grid-minimap-canvas')).toBeVisible();
    const cameraAfterZone = {
      x: Number(await gridArea.getAttribute('data-camera-x')),
      y: Number(await gridArea.getAttribute('data-camera-y')),
      zoom: Number(await gridArea.getAttribute('data-camera-zoom')),
    };
    expect(cameraAfterZone.x !== cameraBefore.x || cameraAfterZone.y !== cameraBefore.y).toBe(true);
    // Zone jumps zoom into a paintable working scale instead of parking at
    // the overview where individual cells are too small to see.
    expect(cameraAfterZone.zoom).toBeGreaterThanOrEqual(0.4);

    await expect(page.locator('.progressive-grid-guide')).toBeVisible({ timeout: 5000 });
    const guideRemaining = Number(await page.locator('.progressive-grid-guide').getAttribute('data-guide-remaining'));
    expect(Number.isInteger(guideRemaining)).toBe(true);
    expect(guideRemaining).toBeGreaterThanOrEqual(0);

    // Mini-map tap jumps to the tapped point and lands at a working scale.
    const minimapCanvas = session.locator('.progressive-grid-minimap-canvas');
    const minimapBox = await minimapCanvas.boundingBox();
    expect(minimapBox).toBeTruthy();
    await minimapCanvas.click({ position: { x: minimapBox.width * 0.92, y: minimapBox.height * 0.92 } });
    const cameraAfterJump = {
      x: Number(await gridArea.getAttribute('data-camera-x')),
      y: Number(await gridArea.getAttribute('data-camera-y')),
      zoom: Number(await gridArea.getAttribute('data-camera-zoom')),
    };
    expect(cameraAfterJump.x !== cameraAfterZone.x || cameraAfterJump.y !== cameraAfterZone.y).toBe(true);
    expect(cameraAfterJump.zoom).toBeGreaterThanOrEqual(1);

    // Touch painting: a real mobile interaction must commit a cell the same
    // way the keyboard path does. The palette color is chosen from the cell
    // under the current camera center so the tap is never a wrong-color tap.
    const viewportBox = await gridArea.boundingBox();
    const centerX = viewportBox.x + viewportBox.width / 2;
    const centerY = viewportBox.y + viewportBox.height / 2;
    const cellFromCamera = async () => {
      const cam = {
        x: Number(await gridArea.getAttribute('data-camera-x')),
        y: Number(await gridArea.getAttribute('data-camera-y')),
        zoom: Number(await gridArea.getAttribute('data-camera-zoom')),
      };
      const worldX = (centerX - viewportBox.x - cam.x) / cam.zoom / 32;
      const worldY = (centerY - viewportBox.y - cam.y) / cam.zoom / 32;
      return {
        x: Math.floor(worldX),
        y: Math.floor(worldY),
        tileX: Math.floor(Math.floor(worldX) / 32),
        tileY: Math.floor(Math.floor(worldY) / 32),
      };
    };
    let touchColor;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const cell = await cellFromCamera();
      const tileResponse = await page.request.get(`/api/colorings/${id}/tiles/${cell.tileX}/${cell.tileY}`);
      expect(tileResponse.ok()).toBe(true);
      const tile = await tileResponse.json();
      const localIndex = (cell.y % 32) * 32 + (cell.x % 32);
      if (Number(tile.filled[localIndex]) === -1) {
        touchColor = Number(tile.cells[localIndex]);
        break;
      }
      await page.keyboard.press('+');
    }
    expect(Number.isInteger(touchColor)).toBe(true);
    const checkedLabel = await palette.getByRole('radio', { checked: true }).textContent();
    if (Number(checkedLabel.trim()) - 1 !== touchColor) {
      await palette.getByRole('radio').nth(touchColor).focus();
      await page.keyboard.press('Enter');
      await expect(palette.getByRole('radio', { checked: true })).toHaveAttribute('data-state', 'selected');
    }
    // Make sure the tapped tile is resident before dispatching a real touch:
    // an unloaded tile would only queue the paint until its fetch resolves.
    const finalCell = await cellFromCamera();
    await page.waitForResponse(
      (response) => response.url().includes(`/tiles/${finalCell.tileX}/${finalCell.tileY}`) && response.ok(),
      { timeout: 10000 },
    ).catch(() => {});
    await page.waitForTimeout(300);
    const touchProgressAction = page.waitForResponse(
      (response) => response.url().includes('/progress/actions') && response.request().method() === 'POST',
    );
    if (touchSession) {
      await touchSession.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: centerX, y: centerY }],
      });
      await touchSession.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
    } else {
      await page.touchscreen.tap(centerX, centerY);
    }
    const touchSaved = await touchProgressAction;
    expect(touchSaved.status()).toBe(200);
    const touchSavedBody = await touchSaved.json();
    expect(touchSavedBody.completed_cells).toBeGreaterThan(0);
    await expect.poll(async () => {
      const cell = await cellFromCamera();
      const tileResponse = await page.request.get(`/api/colorings/${id}/tiles/${cell.tileX}/${cell.tileY}`);
      if (!tileResponse.ok()) return false;
      const tile = await tileResponse.json();
      const localIndex = (cell.y % 32) * 32 + (cell.x % 32);
      return Number(tile.filled[localIndex]) === touchColor;
    }, { timeout: 5000 }).toBe(true);

    // One-finger navigation mode: a drag pans the canvas instead of painting.
    const navButton = session.getByRole('button', { name: 'Режим перемещения' });
    await navButton.click();
    await expect(navButton).toHaveAttribute('aria-pressed', 'true');
    const cameraBeforePan = {
      x: Number(await gridArea.getAttribute('data-camera-x')),
      y: Number(await gridArea.getAttribute('data-camera-y')),
    };
    if (touchSession) {
      await touchSession.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: centerX, y: centerY }],
      });
      await touchSession.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: centerX + 90, y: centerY + 60 }],
      });
      await touchSession.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
    } else {
      await page.touchscreen.tap(centerX, centerY);
      await page.touchscreen.tap(centerX + 90, centerY + 60);
    }
    const cameraAfterPan = {
      x: Number(await gridArea.getAttribute('data-camera-x')),
      y: Number(await gridArea.getAttribute('data-camera-y')),
    };
    expect(cameraAfterPan.x !== cameraBeforePan.x || cameraAfterPan.y !== cameraBeforePan.y).toBe(true);
    await navButton.click();
    await expect(navButton).toHaveAttribute('aria-pressed', 'false');

    // Camera persistence: reopening the coloring restores the same world
    // centre and zoom instead of parking at the overview.
    await page.waitForTimeout(700);
    const savedCameraRaw = await page.evaluate((key) => window.localStorage.getItem(key), `splint:tiled-camera:${id}`);
    expect(savedCameraRaw).toBeTruthy();
    const savedCamera = JSON.parse(savedCameraRaw);
    await page.goto(`/?coloring=${id}`);
    await expect(page.locator('.progressive-coloring-session')).toBeVisible({ timeout: 15000 });
    await dismissOnboarding(page);
    const restoredGridArea = page.locator('.progressive-grid-area');
    const restoredBox = await restoredGridArea.boundingBox();
    const restoredZoom = Number(await restoredGridArea.getAttribute('data-camera-zoom'));
    const restoredX = Number(await restoredGridArea.getAttribute('data-camera-x'));
    const restoredY = Number(await restoredGridArea.getAttribute('data-camera-y'));
    const restoredCenterX = (restoredBox.width / 2 - restoredX) / restoredZoom / 32;
    const restoredCenterY = (restoredBox.height / 2 - restoredY) / restoredZoom / 32;
    expect(Math.abs(restoredCenterX - savedCamera.centerX)).toBeLessThanOrEqual(1);
    expect(Math.abs(restoredCenterY - savedCamera.centerY)).toBeLessThanOrEqual(1);
    expect(Math.abs(restoredZoom - savedCamera.zoom)).toBeLessThan(0.01);

    await canvas.focus();
    await page.keyboard.press('+');
    const zoomAfterIn = Number(await gridArea.getAttribute('data-camera-zoom'));
    expect(zoomAfterIn).toBeGreaterThan(cameraAfterZone.zoom);
    await page.keyboard.press('-');
    const zoomAfterOut = Number(await gridArea.getAttribute('data-camera-zoom'));
    expect(zoomAfterOut).toBeLessThan(zoomAfterIn);

    await page.keyboard.press('0');
    await expect.poll(async () => Number(await gridArea.getAttribute('data-camera-zoom')), { timeout: 3000 })
      .toBeLessThanOrEqual(1.1);
  });
});
