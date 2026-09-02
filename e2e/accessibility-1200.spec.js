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
  await page.getByRole('button', { name: /Загрузить изображение/ }).click();
  await expect(page.locator('.creator-page')).toBeVisible({ timeout: 10000 });
  await page.locator('.file-field input[type="file"]').setInputFiles([fixture]);
  await page.locator('.creator-advanced summary').click();
  // The resolution control is an indexed 0..3 selector; choose the
  // labelled 1200 option instead of relying on the old pixel-count value.
  await page.getByRole('button', { name: 'Сетка 1200 на 1200' }).click();
  // Selecting a resolution starts its preview computation.  Do not click the
  // save button before that computation finishes: it becomes disabled while
  // the tiled payload is being built and the old test raced that transition.
  await expect(page.locator('.creator-previews')).toBeVisible({ timeout: 120000 });
  const saveButton = page.locator('button', { hasText: 'Сохранить работу' });
  await expect(saveButton).toBeVisible({ timeout: 45000 });
  await expect(saveButton).toBeEnabled({ timeout: 120000 });
  const responsePromise = page.waitForResponse((r) => r.url().includes('/colorings/create'));
  // The save action switches the client route immediately after the response;
  // avoid Playwright waiting on a button that is intentionally detached.
  await saveButton.click({ noWaitAfter: true });
  const response = await responsePromise;
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
    // The creator-from-image flow plus touch emulation on a mobile project
    // legitimately takes longer than the global 60s budget; the smart-engine
    // reopen assertion needs headroom on slow emulated devices.
    test.setTimeout(120_000);
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

    // Touch painting: return to the already selected Smart Guidance target
    // before dispatching a real mobile gesture. READY is the app contract
    // that the target tile has been fetched and the immediate camera settle
    // is complete, so this does not depend on a guessed viewport-center cell
    // or on a page.request response that Playwright cannot observe on `page`.
    const returnToTarget = session.getByRole('button', { name: 'Вернуться к цели' });
    await expect(returnToTarget).toBeVisible();
    await returnToTarget.click();
    await expect(session).toHaveAttribute('data-smart-state', 'ready', { timeout: 15000 });
    await expect(session).toHaveAttribute('data-special-offer-kind', '');

    const touchTargetX = Number(await session.getAttribute('data-smart-target-x'));
    const touchTargetY = Number(await session.getAttribute('data-smart-target-y'));
    const touchColor = Number(await session.getAttribute('data-smart-color'));
    expect(Number.isInteger(touchTargetX)).toBe(true);
    expect(Number.isInteger(touchTargetY)).toBe(true);
    expect(Number.isInteger(touchColor)).toBe(true);
    const touchTileX = Math.floor(touchTargetX / 32);
    const touchTileY = Math.floor(touchTargetY / 32);
    const touchTileResponse = await page.request.get(`/api/colorings/${id}/tiles/${touchTileX}/${touchTileY}`);
    expect(touchTileResponse.ok()).toBe(true);
    const touchTile = await touchTileResponse.json();
    const touchLocalIndex = (touchTargetY % 32) * 32 + (touchTargetX % 32);
    expect(Number(touchTile.filled[touchLocalIndex])).toBe(-1);
    expect(Number(touchTile.cells[touchLocalIndex])).toBe(touchColor);
    expect((touchTile.specials || []).some((special) => Number(special.local_index) === touchLocalIndex)).toBe(false);

    const viewportBox = await gridArea.boundingBox();
    const touchCamera = {
      x: Number(await gridArea.getAttribute('data-camera-x')),
      y: Number(await gridArea.getAttribute('data-camera-y')),
      zoom: Number(await gridArea.getAttribute('data-camera-zoom')),
    };
    const centerX = viewportBox.x + touchCamera.x + (touchTargetX + 0.5) * 32 * touchCamera.zoom;
    const centerY = viewportBox.y + touchCamera.y + (touchTargetY + 0.5) * 32 * touchCamera.zoom;
    await canvas.focus();
    await expect(canvas).toBeFocused();
    const touchSurface = await page.evaluate(({ x, y }) => {
      const canvasElement = document.querySelector('.progressive-grid-area canvas');
      const hit = document.elementFromPoint(x, y);
      return {
        activeCanvas: document.activeElement === canvasElement,
        hitCanvas: hit === canvasElement,
        hitTag: hit?.tagName || '',
      };
    }, { x: centerX, y: centerY });
    expect(touchSurface.activeCanvas).toBe(true);
    expect(touchSurface.hitCanvas).toBe(true);
    expect(touchSurface.hitTag).toBe('CANVAS');
    await page.evaluate(() => {
      const area = document.querySelector('.progressive-grid-area');
      window.__a11yTouchEvents = [];
      for (const type of ['pointerdown', 'pointerup', 'pointercancel']) {
        area.addEventListener(type, (event) => {
          window.__a11yTouchEvents.push({ type, pointerId: event.pointerId, pointerType: event.pointerType });
        });
      }
    });
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
    const touchEvents = await page.evaluate(() => window.__a11yTouchEvents || []);
    const touchDown = touchEvents.find((event) => event.type === 'pointerdown');
    const touchUp = touchEvents.find((event) => event.type === 'pointerup');
    expect(touchDown?.pointerType).toBe('touch');
    expect(touchUp?.pointerType).toBe('touch');
    expect(touchUp?.pointerId).toBe(touchDown?.pointerId);
    const persistedTileResponse = await page.request.get(`/api/colorings/${id}/tiles/${touchTileX}/${touchTileY}`);
    expect(persistedTileResponse.ok()).toBe(true);
    const persistedTile = await persistedTileResponse.json();
    expect(Number(persistedTile.filled[touchLocalIndex])).toBe(touchColor);

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

    // Reopening a tiled map goes straight into smart guidance: the engine
    // picks a colour and focuses a paintable target instead of restoring an
    // arbitrary saved camera or parking at the overview.
    await page.goto(`/?coloring=${id}`);
    await expect(page.locator('.progressive-coloring-session')).toBeVisible({ timeout: 15000 });
    await dismissOnboarding(page);
    const restoredGridArea = page.locator('.progressive-grid-area');
    await expect.poll(
      () => page.locator('.progressive-coloring-session').getAttribute('data-smart-state'),
      { timeout: 10000 },
    ).toBe('ready');
    const restoredZoom = Number(await restoredGridArea.getAttribute('data-camera-zoom'));
    expect(restoredZoom).toBeGreaterThanOrEqual(0.4);
    const restoredTarget = await page.locator('.progressive-coloring-session').getAttribute('data-smart-target-tile');
    expect(restoredTarget).not.toBe('');
    const restoredColor = await page.locator('.progressive-coloring-session').getAttribute('data-smart-color');
    expect(restoredColor).not.toBe('');

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
