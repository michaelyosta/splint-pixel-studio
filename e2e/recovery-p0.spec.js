import { test, expect } from '@playwright/test';

const GRID = 160;
const TILE = 32;
const PALETTE = ['#101820', '#ffffff'];

function tiledPayload(width, height, tileSize = TILE) {
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

async function waitForSmartReady(page, timeout = 30000) {
  const session = page.locator('.progressive-coloring-session');
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await session.getAttribute('data-smart-state').catch(() => null);
    if (state === 'ready') return;
    if (state === 'errorRetryable') {
      const retry = page.locator('.progressive-grid-error button:has-text("Повторить")');
      if (await retry.isVisible().catch(() => false)) await retry.click();
    }
    await page.waitForTimeout(750);
  }
  await expect(session).toHaveAttribute('data-smart-state', 'ready', { timeout: 1000 });
}

test('cold root reopen restores the last artwork and resumable state', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'The focused lifecycle verifier runs once in Chromium; real iOS remains a physical gate.');
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': `recovery_p0_${Date.now().toString(36)}` });
  const createdResponse = await page.request.post('/api/colorings/create', {
    data: {
      title: 'Recovery P0 resume fixture',
      storageMode: 'tiled',
      width: GRID,
      height: GRID,
      tileSize: TILE,
      palette: PALETTE,
      tiles: tiledPayload(GRID, GRID),
    },
  });
  expect(createdResponse.ok()).toBe(true);
  const created = await createdResponse.json();

  await page.goto(`/?coloring=${created.id}&splintMetrics=1`);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toHaveAttribute('data-artwork-id', created.id, { timeout: 20000 });
  await waitForSmartReady(page);

  const canvas = page.locator('.progressive-grid-area > canvas');
  await canvas.focus();
  const paintResponse = page.waitForResponse((response) => (
    response.url().includes(`/colorings/${created.id}/progress/actions`)
      && response.request().method() === 'POST'
  ));
  await page.keyboard.press('Enter');
  expect((await (await paintResponse).json()).revision).toBeGreaterThan(0);
  await expect.poll(async () => {
    const response = await page.request.get(`/api/colorings/${created.id}/progress`);
    return (await response.json()).completed_cells;
  }).toBeGreaterThan(0);
  // The fixture may deterministically expose a treatment Special after the
  // first commit. Resolve that transient decision before testing cold resume;
  // the server deliberately does not advance meaningful activity for skips.
  const specialSkip = page.locator('.progressive-grid-special-skip').first();
  if (await specialSkip.isVisible().catch(() => false)) {
    await Promise.all([
      page.waitForResponse((response) => (
        response.url().includes(`/colorings/${created.id}/progress/actions`)
          && response.request().method() === 'POST'
      )),
      specialSkip.click(),
    ]);
    await expect(session).toHaveAttribute('data-special-offer-kind', '', { timeout: 10000 });
  }
  await page.waitForFunction((id) => Object.keys(localStorage).some((key) => key.includes(`:${id}`)), created.id);
  await page.waitForFunction((id) => Object.entries(localStorage).some(([key, value]) => (
    key.includes('resume-current') && value.includes(id)
  )), created.id);
  await page.keyboard.press('+');
  const beforeColdReopen = await page.locator('.progressive-grid-area').evaluate((element) => ({
    x: Number(element.dataset.cameraX),
    y: Number(element.dataset.cameraY),
    zoom: Number(element.dataset.cameraZoom),
  }));

  await page.goto('/');
  await expect(page.locator('.home-page')).toHaveCount(0, { timeout: 20000 });
  await expect(page.locator('.progressive-coloring-session')).toHaveAttribute('data-artwork-id', created.id, { timeout: 20000 });
  await waitForSmartReady(page);
  const afterColdReopen = await page.locator('.progressive-grid-area').evaluate((element) => ({
    x: Number(element.dataset.cameraX),
    y: Number(element.dataset.cameraY),
    zoom: Number(element.dataset.cameraZoom),
  }));
  expect(afterColdReopen.zoom).toBeCloseTo(beforeColdReopen.zoom, 2);
  expect(afterColdReopen.x).toBeCloseTo(beforeColdReopen.x, 0);
  expect(afterColdReopen.y).toBeCloseTo(beforeColdReopen.y, 0);
});
