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

async function createFixture(page) {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': 'user_tiled_reload_journal' });
  const response = await page.request.post('/api/colorings/create', {
    data: {
      title: 'Tiled reload journal verifier',
      storageMode: 'tiled',
      width: GRID,
      height: GRID,
      tileSize: TILE,
      palette: PALETTE,
      tiles: tiledPayload(GRID, GRID),
    },
  });
  expect(response.ok()).toBe(true);
  const created = await response.json();
  const tileResponse = await page.request.get(`/api/colorings/${created.id}/tiles/0/0`);
  expect(tileResponse.ok()).toBe(true);
  const tile = await tileResponse.json();
  const specialIndices = new Set((tile.specials || []).map((special) => Number(special.cell_index)));
  const localIndex = [...Array(TILE * TILE).keys()].find((index) => !specialIndices.has(index));
  return { created, index: localIndex };
}

async function openFixture(page, id, index) {
  await page.goto(`/?coloring=${id}&splintMetrics=1`);
  await expect(page.locator('.progressive-coloring-session')).toBeVisible({ timeout: 20000 });
  const canvas = page.locator('.progressive-grid-area > canvas');
  await expect(canvas).toBeVisible({ timeout: 20000 });
  const tileX = Math.floor((index % GRID) / TILE);
  const tileY = Math.floor(Math.floor(index / GRID) / TILE);
  await page.waitForFunction(() => Boolean(window.__splintClient), null, { timeout: 20000 });
  await page.evaluate(() => window.__splintClient.loadManifest());
  await page.evaluate(({ tileX: xCoord, tileY: yCoord }) => window.__splintClient.fetchTile(xCoord, yCoord), { tileX, tileY });
  await page.waitForFunction(({ xCoord, yCoord }) => Boolean(window.__splintClient?.getCell(xCoord, yCoord)?.loaded), {
    xCoord: index % GRID,
    yCoord: Math.floor(index / GRID),
  }, { timeout: 20000 });
  return canvas;
}

test('offline journal replay reconciles an already resident tile after reload', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'single Chromium verifier keeps the replay race deterministic');
  test.setTimeout(120000);

  const { created, index } = await createFixture(page);
  const canvas = await openFixture(page, created.id, index);
  const x = index % GRID;
  const y = Math.floor(index / GRID);
  await canvas.focus();
  await canvas.press('Home');
  for (let step = 0; step < x; step += 1) await canvas.press('ArrowRight');
  for (let step = 0; step < y; step += 1) await canvas.press('ArrowDown');
  await expect(canvas).toHaveAttribute('data-keyboard-cell', String(index));

  await page.context().setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await canvas.press('Enter');
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.includes('splint:tiled-progress:')
      && JSON.parse(localStorage.getItem(key) || '[]').length > 0).length)).toBe(1);

  // Reopen online, but hold the replay POST until the stale tile has arrived.
  // Install the gate before toggling online: the application's `online`
  // listener flushes the durable journal immediately, so registering the
  // route afterwards creates a verifier race and can commit before the stale
  // tile assertion runs.
  let releaseReplay;
  const replayGate = new Promise((resolve) => { releaseReplay = resolve; });
  await page.route(/\/api\/colorings\/[^/]+\/progress\/actions$/, async (route) => {
    const body = route.request().postDataJSON();
    if (!Array.isArray(body?.changes) || body.changes.length === 0) return route.continue();
    await replayGate;
    return route.continue();
  });
  await page.context().setOffline(false);
  await page.reload();
  await expect(page.locator('.progressive-coloring-session')).toBeVisible({ timeout: 20000 });
  await page.waitForFunction(() => Boolean(window.__splintClient), null, { timeout: 20000 });
  await page.evaluate(() => window.__splintClient.loadManifest());
  await page.evaluate(({ tileX: xCoord, tileY: yCoord }) => window.__splintClient.fetchTile(xCoord, yCoord), {
    tileX: Math.floor(x / TILE),
    tileY: Math.floor(y / TILE),
  });
  await page.waitForFunction((cellIndex) => {
    const client = window.__splintClient;
    const xCoord = cellIndex % 160;
    const yCoord = Math.floor(cellIndex / 160);
    return client?.getCell(xCoord, yCoord)?.loaded;
  }, index, { timeout: 20000 });
  await expect.poll(() => page.evaluate((cellIndex) => {
    const client = window.__splintClient;
    const xCoord = cellIndex % 160;
    const yCoord = Math.floor(cellIndex / 160);
    return client?.getCell(xCoord, yCoord)?.filled ?? null;
  }, index)).toBe(-1);

  const replayResponse = page.waitForResponse((response) => response.url().includes(`/colorings/${created.id}/progress/actions`));
  releaseReplay();
  expect((await replayResponse).ok()).toBe(true);
  await expect.poll(() => page.evaluate((cellIndex) => {
    const client = window.__splintClient;
    const xCoord = cellIndex % 160;
    const yCoord = Math.floor(cellIndex / 160);
    return client?.getCell(xCoord, yCoord)?.filled ?? null;
  }, index), { timeout: 20000 }).toBe(0);

  const progressResponse = await page.request.get(`/api/colorings/${created.id}/progress`);
  expect(progressResponse.ok()).toBe(true);
  const progress = await progressResponse.json();
  expect(progress.completed_cells).toBe(1);
});
