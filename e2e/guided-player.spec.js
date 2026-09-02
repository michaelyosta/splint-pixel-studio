import { test, expect } from '@playwright/test';

const WIDTH = 1200;
const HEIGHT = 1200;
const TILE_SIZE = 32;

async function screenPoint(gridArea, camera, cellX, cellY) {
  const box = await gridArea.boundingBox();
  return {
    x: box.x + camera.x + (cellX + 0.5) * 32 * camera.zoom,
    y: box.y + camera.y + (cellY + 0.5) * 32 * camera.zoom,
  };
}

test('1200x1200 guided player autofocuses, auto-advances, and supports free exploration + return', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', '1200x1200 tiled creation is not practical on WebKit emulation');
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': 'e2e_guided_1200' });
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
  await page.setViewportSize({ width: 390, height: 844 });

  // Capture tile responses before navigation. A waitForResponse registered
  // after READY can only miss an already-completed response and hide the
  // readiness failure behind its timeout.
  const tileResponseEvidence = new Map();
  page.on('response', (response) => {
    const match = response.url().match(/\/tiles\/(\d+)\/(\d+)(?:[/?]|$)/);
    if (!match) return;
    const key = `${match[1]}:${match[2]}`;
    const entries = tileResponseEvidence.get(key) ?? [];
    entries.push({
      status: response.status(),
      url: response.url(),
      response,
    });
    tileResponseEvidence.set(key, entries);
  });

  // This scenario verifies the generic guided player contract. Use the
  // deterministic control fixture so a random special-cell placement cannot
  // interrupt the stroke before the auto-advance assertion.
  const fixtureResponse = await page.request.post('/api/__e2e/seed-cohort-template', {
    data: {
      cohort: 'control',
      storage: 'tiled',
      size: { width: WIDTH, height: HEIGHT },
    },
    timeout: 120000,
  });
  expect(fixtureResponse.ok()).toBe(true);
  const fixture = await fixtureResponse.json();
  expect(fixture.cohort).toBe('control');
  expect(fixture.storage).toBe('tiled');
  expect(fixture.size).toEqual({ width: WIDTH, height: HEIGHT });
  const created = { id: fixture.id };

  const guidanceResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/guidance') && response.ok(),
    { timeout: 15000 },
  );
  await page.goto(`/?coloring=${created.id}`);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toBeVisible({ timeout: 20000 });

  // INITIAL AUTOPILOT: no palette/minimap interaction, yet the engine picks
  // a colour, focuses a paintable target, and the camera lands at working zoom.
  await expect.poll(
    () => session.getAttribute('data-smart-state'),
    { timeout: 15000 },
  ).toBe('ready');
  const guidanceResponse = await guidanceResponsePromise;
  const guidanceBody = await guidanceResponse.json();
  expect('cells' in guidanceBody).toBe(false);
  expect('filled' in guidanceBody).toBe(false);
  expect(guidanceBody.target).toBeTruthy();

  const smartColor = Number(await session.getAttribute('data-smart-color'));
  expect(Number.isInteger(smartColor)).toBe(true);
  const palette = page.getByRole('radiogroup', { name: 'Палитра цветов' });
  await expect(palette.getByRole('radio', { checked: true })).toHaveAttribute('data-state', 'selected');

  const gridArea = page.locator('.progressive-grid-area');
  const camera = {
    x: Number(await gridArea.getAttribute('data-camera-x')),
    y: Number(await gridArea.getAttribute('data-camera-y')),
    zoom: Number(await gridArea.getAttribute('data-camera-zoom')),
  };
  expect(camera.zoom).toBeGreaterThanOrEqual(0.4);
  const targetTile = await session.getAttribute('data-smart-target-tile');
  expect(targetTile).not.toBe('');
  const minX = Number(await session.getAttribute('data-smart-target-min-x'));
  const maxX = Number(await session.getAttribute('data-smart-target-max-x'));
  const minY = Number(await session.getAttribute('data-smart-target-min-y'));
  const maxY = Number(await session.getAttribute('data-smart-target-max-y'));
  const guide = page.locator('.progressive-grid-guide');
  await expect(guide).toBeVisible({ timeout: 5000 });
  const globalRemaining = Number(await guide.getAttribute('data-guide-remaining'));
  expect(globalRemaining).toBeGreaterThan(0);

  // The target response may have completed before READY was observable, so
  // inspect the response evidence captured from navigation instead of
  // waiting for a historical response event.
  const targetTileResponses = await Promise.all(
    (tileResponseEvidence.get(targetTile) ?? []).map(async ({ status, url, response }) => ({
      status,
      url,
      body: await response.text().catch((error) => `[body unavailable: ${error.message}]`),
    })),
  );
  expect(
    targetTileResponses.some(({ status }) => status === 200),
    `target tile ${targetTile} response evidence missing or not OK: ${JSON.stringify({
      observedTileKeys: [...tileResponseEvidence.keys()],
      responses: targetTileResponses,
    })}`,
  ).toBe(true);

  // Paint the whole actionable window in one stroke. A single move per row
  // lets the stroke rasterizer fill every cell in that row, which is robust
  // against the browser coalescing rapid per-cell mouse events.
  const firstPoint = await screenPoint(gridArea, camera, minX, minY);
  await page.mouse.move(firstPoint.x, firstPoint.y);
  await page.mouse.down();
  const progressAction = page.waitForResponse(
    (response) => response.url().includes('/progress/actions') && response.request().method() === 'POST',
  );
  // Browser mouse events are coalesced per frame; several passes over the
  // same rows guarantee the whole window is actually covered even if some
  // intermediate moves are dropped.
  for (let pass = 0; pass < 4; pass += 1) {
    let reverse = pass % 2 === 1;
    for (let y = minY; y <= maxY; y += 1) {
      const startX = reverse ? maxX : minX;
      const endX = reverse ? minX : maxX;
      const start = await screenPoint(gridArea, camera, startX, y);
      const end = await screenPoint(gridArea, camera, endX, y);
      await page.mouse.move(start.x, start.y);
      await page.mouse.move(end.x, end.y);
      await page.waitForTimeout(16);
    }
  }
  await page.mouse.up();
  const saved = await progressAction;
  expect(saved.status()).toBe(200);
  expect((await saved.json()).completed_cells).toBeGreaterThan(0);

  // SAME_COLOR/NEXT_COLOR auto-advance: no button press, the engine moves on.
  await expect.poll(
    async () => {
      const state = await session.getAttribute('data-smart-state');
      const currentTarget = await session.getAttribute('data-smart-target-tile');
      return state === 'ready' && currentTarget && currentTarget !== targetTile ? currentTarget : null;
    },
    { timeout: 15000 },
  ).not.toBeNull();

  // FREE EXPLORATION: a manual pan pauses the automatic camera and it stays
  // paused while the user explores.
  await session.getByRole('button', { name: 'Режим перемещения' }).click();
  const box = await gridArea.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 80, { steps: 4 });
  await page.mouse.up();
  await expect.poll(
    () => session.getAttribute('data-smart-state'),
    { timeout: 5000 },
  ).toBe('freeExploration');
  const freeCamera = {
    x: Number(await gridArea.getAttribute('data-camera-x')),
    y: Number(await gridArea.getAttribute('data-camera-y')),
  };
  await page.waitForTimeout(1500);
  expect(await session.getAttribute('data-smart-state')).toBe('freeExploration');
  const afterWaitCamera = {
    x: Number(await gridArea.getAttribute('data-camera-x')),
    y: Number(await gridArea.getAttribute('data-camera-y')),
  };
  expect(afterWaitCamera.x).toBe(freeCamera.x);
  expect(afterWaitCamera.y).toBe(freeCamera.y);

  // RETURN TO TARGET restores the smart route without user navigation.
  await session.getByRole('button', { name: 'Вернуться к цели' }).click();
  await expect.poll(
    () => session.getAttribute('data-smart-state'),
    { timeout: 10000 },
  ).toBe('ready');
  const returnedZoom = Number(await gridArea.getAttribute('data-camera-zoom'));
  expect(returnedZoom).toBeGreaterThanOrEqual(0.4);
  expect(await session.getAttribute('data-smart-target-tile')).not.toBe('');

  // BOUNDED CLIENT: the tiled cache stays bounded and no full-grid arrays are
  // ever delivered through guidance/manifest.
  const metrics = await page.evaluate(() => window.__splintTiledMetrics || null);
  expect(metrics).toBeTruthy();
  expect(metrics.cacheTiles).toBeLessThanOrEqual(48);
  const manifestResponse = await page.request.get(`/api/colorings/${created.id}/manifest`);
  const manifestBody = await manifestResponse.json();
  expect('cells' in manifestBody).toBe(false);
  expect('filled' in manifestBody).toBe(false);
});
