import { test, expect } from '@playwright/test';

const GRID = 64;
const TILE = 32;
const PALETTE = ['#101820', '#ffffff'];

function legacyPayload() {
  return {
    storageMode: 'legacy',
    width: 28,
    height: 28,
    palette: PALETTE,
    cells: Array(28 * 28).fill(0),
  };
}

function tiledPayload(width = GRID, height = GRID, tileSize = TILE) {
  const tiles = [];
  for (let tileY = 0; tileY < Math.ceil(height / tileSize); tileY += 1) {
    for (let tileX = 0; tileX < Math.ceil(width / tileSize); tileX += 1) {
      const tileWidth = Math.min(tileSize, width - tileX * tileSize);
      const tileHeight = Math.min(tileSize, height - tileY * tileSize);
      tiles.push({
        tile_x: tileX,
        tile_y: tileY,
        width: tileWidth,
        height: tileHeight,
        cells: Array(tileWidth * tileHeight).fill(0),
      });
    }
  }
  return tiles;
}

async function createForCohort(page, { cohort, payload }) {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': `e2e_bfcache_${cohort}` });
  const fixtureResponse = await page.request.post('/api/__e2e/seed-cohort-template', {
    data: {
      cohort,
      storage: payload.storageMode === 'tiled' ? 'tiled' : 'legacy',
      size: { width: payload.width, height: payload.height },
    },
  });
  expect(fixtureResponse.ok()).toBe(true);
  const fixture = await fixtureResponse.json();
  expect(fixture.cohort).toBe(cohort);
  expect(fixture.storage).toBe(payload.storageMode === 'tiled' ? 'tiled' : 'legacy');
  expect(fixture.size).toEqual({ width: payload.width, height: payload.height });
  const progressResponse = await page.request.get(`/api/colorings/${fixture.id}/progress`);
  expect(progressResponse.ok()).toBe(true);
  const progress = await progressResponse.json();
  return { created: { id: fixture.id }, progress };
}

async function focusLegacyCell(page, index) {
  const canvas = page.locator('.coloring-canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('.coloring-canvas-viewport')).toHaveAttribute('data-interaction-disabled', 'false', { timeout: 10000 });
  await canvas.focus();
  await expect(canvas).toBeFocused();
  await canvas.press('Home');
  await expect(canvas).toHaveAttribute('data-keyboard-cell', '0', { timeout: 5000 });
  const x = index % 28;
  const y = Math.floor(index / 28);
  for (let step = 0; step < x; step += 1) await canvas.press('ArrowRight');
  for (let step = 0; step < y; step += 1) await canvas.press('ArrowDown');
  await expect(canvas).toHaveAttribute('data-keyboard-cell', String(index));
  return canvas;
}

async function focusTiledCell(page, canvas, index) {
  await canvas.focus();
  await expect(canvas).toBeFocused();
  await canvas.press('Home');
  await expect(canvas).toHaveAttribute('data-keyboard-cell', '0', { timeout: 5000 });
  const x = index % GRID;
  const y = Math.floor(index / GRID);
  for (let step = 0; step < x; step += 1) await canvas.press('ArrowRight');
  for (let step = 0; step < y; step += 1) await canvas.press('ArrowDown');
  await expect(canvas).toHaveAttribute('data-keyboard-cell', String(index));
}

async function openTiledControl(page, id) {
  await page.goto(`/?coloring=${id}&splintMetrics=1`);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toBeVisible({ timeout: 20000 });
  const canvas = page.locator('.progressive-grid-area > canvas');
  await expect(canvas).toBeVisible({ timeout: 20000 });
  await page.waitForFunction(() => Boolean(window.__splintClient), null, { timeout: 20000 });
  await page.evaluate(() => window.__splintClient.loadManifest());
  await page.evaluate(() => window.__splintClient.fetchTile(0, 0));
  await page.waitForFunction(({ xCoord, yCoord }) => Boolean(window.__splintClient?.getCell(xCoord, yCoord)?.loaded), {
    xCoord: 1,
    yCoord: 0,
  }, { timeout: 20000 });
  return canvas;
}

async function waitForCompletedCells(page, id, expected) {
  await expect.poll(async () => {
    const response = await page.request.get(`/api/colorings/${id}/progress`);
    expect(response.ok()).toBe(true);
    return (await response.json()).completed_cells;
  }, { timeout: 20000 }).toBe(expected);
}

async function persistedPageTransition(page, type) {
  await page.evaluate((eventType) => {
    window.dispatchEvent(new PageTransitionEvent(eventType, { persisted: true }));
  }, type);
}

test('legacy queue keeps painting after persisted pagehide/pageshow', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'single Chromium bfcache verifier keeps the event ordering deterministic');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });
  const { created } = await createForCohort(page, {
    cohort: 'control',
    payload: legacyPayload(),
  });

  await page.goto(`/?coloring=${created.id}`);
  await expect(page.locator('.coloring-session')).toBeVisible({ timeout: 15000 });
  const canvas = await focusLegacyCell(page, 1);
  const firstSave = page.waitForResponse((response) => response.url().includes(`/colorings/${created.id}/progress/actions`)
    && response.request().method() === 'POST');
  await canvas.press('Enter');
  expect((await (await firstSave).json()).revision).toBeGreaterThan(0);
  await waitForCompletedCells(page, created.id, 1);

  await persistedPageTransition(page, 'pagehide');
  await persistedPageTransition(page, 'pageshow');
  const secondCanvas = await focusLegacyCell(page, 2);
  const secondSave = page.waitForResponse((response) => response.url().includes(`/colorings/${created.id}/progress/actions`)
    && response.request().method() === 'POST');
  await secondCanvas.press('Enter');
  expect((await (await secondSave).json()).revision).toBeGreaterThan(0);
  await waitForCompletedCells(page, created.id, 2);
});

test('tiled queue keeps painting after persisted pagehide/pageshow', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'single Chromium bfcache verifier keeps the event ordering deterministic');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });
  const { created } = await createForCohort(page, {
    cohort: 'control',
    payload: {
      storageMode: 'tiled',
      width: GRID,
      height: GRID,
      tileSize: TILE,
      palette: PALETTE,
      tiles: tiledPayload(),
    },
  });

  const canvas = await openTiledControl(page, created.id);
  await focusTiledCell(page, canvas, 1);
  const firstSave = page.waitForResponse((response) => response.url().includes(`/colorings/${created.id}/progress/actions`)
    && response.request().method() === 'POST');
  await canvas.press('Enter');
  expect((await (await firstSave).json()).revision).toBeGreaterThan(0);
  await waitForCompletedCells(page, created.id, 1);

  await persistedPageTransition(page, 'pagehide');
  await persistedPageTransition(page, 'pageshow');
  await focusTiledCell(page, canvas, 2);
  const secondSave = page.waitForResponse((response) => response.url().includes(`/colorings/${created.id}/progress/actions`)
    && response.request().method() === 'POST');
  await canvas.press('Enter');
  expect((await (await secondSave).json()).revision).toBeGreaterThan(0);
  await waitForCompletedCells(page, created.id, 2);
});

test('mock Telegram bridge disables on player enter, survives bfcache, and restores on leave', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'mock bridge lifecycle verifier is deterministic on Chromium');
  await page.route('https://telegram.org/js/telegram-web-app.js', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: `window.Telegram = window.Telegram || { WebApp: {
        // This test exercises Telegram bridge lifecycle, not Telegram auth.
        // Keep initData empty so the signed-initData path cannot reject the
        // deliberate X-User-Id fixture used by createForCohort.
        initData: '',
        version: '8.0',
        isVerticalSwipesEnabled: true,
        isVersionAtLeast: () => true,
        disableVerticalSwipes() { this.isVerticalSwipesEnabled = false; },
        enableVerticalSwipes() { this.isVerticalSwipesEnabled = true; },
        ready() {}, expand() {}, onEvent() {},
        setHeaderColor() {},
        HapticFeedback: {},
        BackButton: { onClick() {}, offClick() {}, show() {}, hide() {} }
      } };`,
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });
  const { created } = await createForCohort(page, {
    cohort: 'control',
    payload: legacyPayload(),
  });

  await page.goto(`/?coloring=${created.id}`);
  await expect(page.locator('.coloring-session')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => page.evaluate(() => window.Telegram.WebApp.isVerticalSwipesEnabled)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-tg-swipe-protected'))).toBe(false);

  await persistedPageTransition(page, 'pagehide');
  await persistedPageTransition(page, 'pageshow');
  await expect.poll(() => page.evaluate(() => window.Telegram.WebApp.isVerticalSwipesEnabled)).toBe(false);

  await page.locator('.back-button').click();
  await expect(page.locator('.app-container')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.Telegram.WebApp.isVerticalSwipesEnabled)).toBe(true);
});

test('browser SDK stub without initData does not apply the global overscroll fallback', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'mock bridge lifecycle verifier is deterministic on Chromium');
  await page.route('https://telegram.org/js/telegram-web-app.js', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: `window.Telegram = window.Telegram || { WebApp: {
        initData: '',
        version: '7.6',
        isVerticalSwipesEnabled: true,
        ready() {}, expand() {}, onEvent() {},
        HapticFeedback: {},
        BackButton: { onClick() {}, offClick() {}, show() {}, hide() {} }
      } };`,
    });
  });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });
  const { created } = await createForCohort(page, {
    cohort: 'control',
    payload: legacyPayload(),
  });
  await page.goto(`/?coloring=${created.id}`);
  await expect(page.locator('.coloring-session')).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-tg-swipe-protected'))).toBe(false);
});
