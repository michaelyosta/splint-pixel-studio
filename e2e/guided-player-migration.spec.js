import { test, expect } from '@playwright/test';

/**
 * P0 regression suite for the tiled SMART ENGINE cold start.
 *
 * Scenarios (mirroring the P0 task):
 *   #1 migrated real template  — pre-021 template + existing progress opened
 *        by the real app flow: guidance builds its index on demand, the
 *        engine autofocuses, and the FIRST user action is PAINT (no palette,
 *        no minimap, no retry).
 *   #2 cold target             — the guidance target tile is NOT among the
 *        initial overview-loaded tiles; it must be explicitly requested
 *        before READY.
 *   #3 slow network            — a delayed target tile still reaches READY
 *        through the explicit LOADING_TARGET state, not an overview dead-end.
 *   #4 old camera              — a persisted overview camera in localStorage
 *        must not prevent smart guidance from becoming actionable.
 *   #5 failed tile + recovery  — a transient 500 on the target tile shows the
 *        retryable error; Повторить reloads guidance, focuses, and paints.
 */

const WIDTH = 1200;
const HEIGHT = 1200;
const TILE_SIZE = 32;
const STRIPE_PALETTE = ['#101820', '#ffffff', '#ff6b6b'];
const HOLE_PALETTE = ['#101820', '#ffffff'];
const TEST_USER = 'e2e_guided_1200';

function stripeCells(tileX, tileY, width, height) {
  const cells = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      cells.push((tileX * 3 + tileY * 5 + x + y * 2) % STRIPE_PALETTE.length);
    }
  }
  return cells;
}

function buildTiledPayload({ palette = STRIPE_PALETTE, centerHole = false } = {}) {
  const columns = Math.ceil(WIDTH / TILE_SIZE);
  const rows = Math.ceil(HEIGHT / TILE_SIZE);
  const tiles = [];
  for (let tileY = 0; tileY < rows; tileY += 1) {
    for (let tileX = 0; tileX < columns; tileX += 1) {
      // Edge tiles are partial: the last column/row is narrower/shorter.
      const width = tileX === columns - 1 ? WIDTH - tileX * TILE_SIZE : TILE_SIZE;
      const height = tileY === rows - 1 ? HEIGHT - tileY * TILE_SIZE : TILE_SIZE;
      let cells;
      if (centerHole) {
        // Colour 1 everywhere EXCEPT a 9x9 centre block (tiles 14..22) which
        // is colour 0. Colour 1 is the most-remaining colour and its nearest
        // cells sit OUTSIDE the initial overview-loaded neighbourhood, so the
        // smart engine must fetch the target tile explicitly.
        const inHole = tileX >= 14 && tileX <= 22 && tileY >= 14 && tileY <= 22;
        cells = new Array(width * height).fill(inHole ? 0 : 1);
      } else {
        cells = stripeCells(tileX, tileY, width, height);
      }
      tiles.push({ tile_x: tileX, tile_y: tileY, width, height, cells });
    }
  }
  return tiles;
}

async function prepareApp(page) {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': TEST_USER });
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
}

async function createTemplate(page, { centerHole = false } = {}) {
  const response = await page.request.post('/api/colorings/create', {
    data: {
      title: `Guided cold ${centerHole ? 'hole' : 'stripe'} ${Date.now()}`,
      storageMode: 'tiled',
      width: WIDTH,
      height: HEIGHT,
      tileSize: TILE_SIZE,
      palette: centerHole ? HOLE_PALETTE : STRIPE_PALETTE,
      tiles: buildTiledPayload({ centerHole }),
    },
    timeout: 60000,
  });
  expect(response.ok()).toBe(true);
  const created = await response.json();
  expect(created.storage_mode).toBe('tiled');
  return created;
}

async function seedPre021Template(page, { color = 1, cells = 900 } = {}) {
  const response = await page.request.post('/api/__e2e/seed-pre021-template', {
    data: {
      width: WIDTH,
      height: HEIGHT,
      tileSize: TILE_SIZE,
      palette: STRIPE_PALETTE,
      progress: { color, cells },
    },
    timeout: 60000,
  });
  expect(response.ok()).toBe(true);
  const created = await response.json();
  expect(created.pre021).toBe(true);
  return created;
}

async function screenPoint(gridArea, camera, cellX, cellY) {
  const box = await gridArea.boundingBox();
  return {
    x: box.x + camera.x + (cellX + 0.5) * TILE_SIZE * camera.zoom,
    y: box.y + camera.y + (cellY + 0.5) * TILE_SIZE * camera.zoom,
  };
}

async function readCamera(gridArea) {
  return {
    x: Number(await gridArea.getAttribute('data-camera-x')),
    y: Number(await gridArea.getAttribute('data-camera-y')),
    zoom: Number(await gridArea.getAttribute('data-camera-zoom')),
  };
}

// ── E2E #1 — MIGRATED REAL TEMPLATE ─────────────────────────────────────────
test('migrated pre-021 template: autopilot focuses a real target and the FIRST tap paints', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', '1200x1200 tiled creation is not practical on WebKit emulation');
  await prepareApp(page);

  // Simulate a template created BEFORE migration 021 with existing progress.
  const seeded = await seedPre021Template(page);
  expect(seeded.id).toBeTruthy();

  const guidanceResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/guidance') && response.ok(),
    { timeout: 30000 },
  );
  await page.goto(`/?coloring=${seeded.id}`);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toBeVisible({ timeout: 20000 });

  // The guidance endpoint must have built the index on demand and returned a
  // real target (never an index-missing dead-end).
  const guidanceResponse = await guidanceResponsePromise;
  const guidanceBody = await guidanceResponse.json();
  expect(guidanceBody.index_missing).toBeFalsy();
  expect(guidanceBody.target).toBeTruthy();
  expect('cells' in guidanceBody).toBe(false);

  await expect.poll(
    () => session.getAttribute('data-smart-state'),
    { timeout: 60000 },
  ).toBe('ready');

  // Auto-selected colour, no palette interaction.
  const smartColor = Number(await session.getAttribute('data-smart-color'));
  expect(Number.isInteger(smartColor)).toBe(true);
  const palette = page.getByRole('radiogroup', { name: 'Палитра цветов' });
  await expect(palette.getByRole('radio', { checked: true })).toHaveAttribute('data-state', 'selected');

  // Working zoom + target tile resident.
  const gridArea = page.locator('.progressive-grid-area');
  const camera = await readCamera(gridArea);
  expect(camera.zoom).toBeGreaterThanOrEqual(0.4);
  const targetTile = await session.getAttribute('data-smart-target-tile');
  expect(targetTile).not.toBe('');
  const [tileX, tileY] = targetTile.split(':').map(Number);
  await page.waitForResponse(
    (response) => response.url().includes(`/tiles/${tileX}/${tileY}`) && response.ok(),
    { timeout: 15000 },
  ).catch(() => {});

  // FIRST USER ACTION = PAINT: tap the suggested anchor cell, nothing else.
  const targetX = Number(await session.getAttribute('data-smart-target-x'));
  const targetY = Number(await session.getAttribute('data-smart-target-y'));
  const anchor = await screenPoint(gridArea, camera, targetX, targetY);
  await page.mouse.move(anchor.x, anchor.y);
  const progressAction = page.waitForResponse(
    (response) => response.url().includes('/progress/actions') && response.request().method() === 'POST',
  );
  await page.mouse.down();
  await page.mouse.up();
  const saved = await progressAction;
  expect(saved.status()).toBe(200);
  const savedBody = await saved.json();
  expect(Number(savedBody.completed_cells)).toBeGreaterThan(0);

  // No "Фрагмент пока недоступен" anywhere.
  const notice = page.locator('.progressive-grid-input-notice');
  await expect(notice).toHaveCount(0);
});

// ── E2E #2 — COLD TARGET ────────────────────────────────────────────────────
test('cold target: the guidance target tile is explicitly requested before READY even when far from the overview', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', '1200x1200 tiled creation is not practical on WebKit emulation');
  await prepareApp(page);
  const created = await createTemplate(page, { centerHole: true });

  const tileRequests = [];
  page.on('request', (request) => {
    const match = String(request.url()).match(/\/tiles\/(\d+)\/(\d+)/);
    if (match) tileRequests.push({ tileX: Number(match[1]), tileY: Number(match[2]), at: Date.now() });
  });

  await page.goto(`/?coloring=${created.id}`);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toBeVisible({ timeout: 20000 });

  await expect.poll(
    () => session.getAttribute('data-smart-state'),
    { timeout: 20000 },
  ).toBe('ready');

  const targetTile = await session.getAttribute('data-smart-target-tile');
  expect(targetTile).not.toBe('');
  const [tileX, tileY] = targetTile.split(':').map(Number);

  // The target must be far from the centre tile (18,18) — outside the
  // 48-tile overview neighbourhood (the 9x9 centre block is colour 0).
  const distance = Math.max(Math.abs(tileX - 18), Math.abs(tileY - 18));
  expect(distance).toBeGreaterThanOrEqual(4);

  // The target tile must have been explicitly requested over the network.
  const requested = tileRequests.some((entry) => entry.tileX === tileX && entry.tileY === tileY);
  expect(requested).toBe(true);

  // And it must be resident: tapping its anchor paints on the first tap.
  const camera = await readCamera(page.locator('.progressive-grid-area'));
  const targetX = Number(await session.getAttribute('data-smart-target-x'));
  const targetY = Number(await session.getAttribute('data-smart-target-y'));
  const anchor = await screenPoint(page.locator('.progressive-grid-area'), camera, targetX, targetY);
  await page.mouse.move(anchor.x, anchor.y);
  const progressAction = page.waitForResponse(
    (response) => response.url().includes('/progress/actions') && response.request().method() === 'POST',
  );
  await page.mouse.down();
  await page.mouse.up();
  expect((await progressAction).status()).toBe(200);
});

// ── E2E #3 — SLOW NETWORK ───────────────────────────────────────────────────
test('slow target tile load: LOADING_TARGET is shown, then auto-focus to READY (no overview dead-end)', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', '1200x1200 tiled creation is not practical on WebKit emulation');
  await prepareApp(page);
  const created = await createTemplate(page);

  // Delay every tile response; the guidance plan still arrives immediately,
  // so the explicit target preload must surface the LOADING_TARGET state.
  await page.route('**/api/colorings/*/tiles/*/*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.continue();
  });

  await page.goto(`/?coloring=${created.id}`);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toBeVisible({ timeout: 20000 });

  // The loading indication must appear at least once…
  await expect.poll(
    async () => {
      const state = await session.getAttribute('data-smart-state');
      return state;
    },
    { timeout: 20000 },
  ).toBe('loadingTarget');

  // …and the engine must still land on a working target without any click.
  await expect.poll(
    () => session.getAttribute('data-smart-state'),
    { timeout: 30000 },
  ).toBe('ready');
  const camera = await readCamera(page.locator('.progressive-grid-area'));
  expect(camera.zoom).toBeGreaterThanOrEqual(0.4);
  expect(await session.getAttribute('data-smart-target-tile')).not.toBe('');
});

// ── E2E #4 — OLD CAMERA ─────────────────────────────────────────────────────
test('persisted overview camera does not prevent smart guidance from becoming actionable', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', '1200x1200 tiled creation is not practical on WebKit emulation');
  await prepareApp(page);
  const created = await createTemplate(page);

  // Simulate a previous session that saved a far-away overview camera.
  await page.addInitScript(({ key }) => {
    try {
      localStorage.setItem(key, JSON.stringify({ centerX: 15, centerY: 15, zoom: 0.08, savedAt: Date.now() }));
    } catch {
      // Storage may be unavailable.
    }
  }, { key: `splint:tiled-camera:${created.id}` });

  await page.goto(`/?coloring=${created.id}`);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toBeVisible({ timeout: 20000 });

  await expect.poll(
    () => session.getAttribute('data-smart-state'),
    { timeout: 20000 },
  ).toBe('ready');
  expect(await session.getAttribute('data-smart-target-tile')).not.toBe('');
  const camera = await readCamera(page.locator('.progressive-grid-area'));
  expect(camera.zoom).toBeGreaterThanOrEqual(0.4);
  const smartColor = Number(await session.getAttribute('data-smart-color'));
  expect(Number.isInteger(smartColor)).toBe(true);
});

// ── E2E #5 — FAILED TILE THEN RECOVERY ──────────────────────────────────────
test('transient 500 on the target tile shows the retryable error and recovers via Повторить', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', '1200x1200 tiled creation is not practical on WebKit emulation');
  await prepareApp(page);
  const created = await createTemplate(page, { centerHole: true });

  // Ask the server for the plan first (same deterministic centre-hole map, so
  // the in-page bootstrap computes the same target), then fail that exact
  // tile once — only the guidance preload requests it (it is far from the
  // overview neighbourhood), so the failure deterministically hits the smart
  // engine instead of the generic viewport loader.
  const preflight = await page.request.get(`/api/colorings/${created.id}/guidance`, {
    headers: { 'X-User-Id': TEST_USER },
  });
  expect(preflight.ok()).toBe(true);
  const preflightBody = await preflight.json();
  expect(preflightBody.target).toBeTruthy();
  const { tile_x: failTileX, tile_y: failTileY } = preflightBody.target;

  let failuresLeft = 1;
  await page.route(`**/api/colorings/${created.id}/tiles/${failTileX}/${failTileY}*`, async (route) => {
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'transient tile failure', code: 'TILE_500' }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto(`/?coloring=${created.id}`);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toBeVisible({ timeout: 20000 });

  // The smart engine must surface an explicit retryable state, not an inert
  // overview pretending everything is fine.
  await expect.poll(
    () => session.getAttribute('data-smart-state'),
    { timeout: 20000 },
  ).toBe('errorRetryable');
  const errorBanner = page.locator('[data-smart-error="true"]');
  await expect(errorBanner).toBeVisible();
  await expect(errorBanner).toContainText('Не удалось подготовить следующий фрагмент');

  // Retry → guidance/target reload → focus → paint works.
  await errorBanner.getByRole('button', { name: 'Повторить' }).click();
  await expect.poll(
    () => session.getAttribute('data-smart-state'),
    { timeout: 20000 },
  ).toBe('ready');
  const camera = await readCamera(page.locator('.progressive-grid-area'));
  expect(camera.zoom).toBeGreaterThanOrEqual(0.4);
  const targetX = Number(await session.getAttribute('data-smart-target-x'));
  const targetY = Number(await session.getAttribute('data-smart-target-y'));
  const anchor = await screenPoint(page.locator('.progressive-grid-area'), camera, targetX, targetY);
  await page.mouse.move(anchor.x, anchor.y);
  const progressAction = page.waitForResponse(
    (response) => response.url().includes('/progress/actions') && response.request().method() === 'POST',
  );
  await page.mouse.down();
  await page.mouse.up();
  expect((await progressAction).status()).toBe(200);
});
