import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * FINAL ACCEPTANCE EVIDENCE — the exact P0 scenario:
 *   real 1200×1200 map with existing progress → clear tile cache → open in a
 *   mobile viewport → touch NOTHING → the app itself must land on a small
 *   working area → the first user action is PAINT.
 *
 * Saves a mobile screenshot to docs/evidence/p0-final-acceptance.png.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(__dirname, '..', 'docs', 'evidence');
const WIDTH = 1200;
const HEIGHT = 1200;
const TILE_SIZE = 32;
const STRIPE_PALETTE = ['#101820', '#ffffff', '#ff6b6b', '#3ecf8e', '#f7c948', '#8ab4f8'];
const TEST_USER = 'e2e_guided_1200';

test('final acceptance: real 1200x1200 with existing progress, zero interactions, first action = PAINT', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'evidence captured on chromium');
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  await page.context().setExtraHTTPHeaders({ 'X-User-Id': TEST_USER });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('splint_onboarding_version', '2');
      // No pre-existing camera: this run starts from a truly cold browser.
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

  // Create the template through the public API (post-021 code path)…
  const tiles = [];
  const columns = Math.ceil(WIDTH / TILE_SIZE);
  const rows = Math.ceil(HEIGHT / TILE_SIZE);
  for (let tileY = 0; tileY < rows; tileY += 1) {
    for (let tileX = 0; tileX < columns; tileX += 1) {
      const width = tileX === columns - 1 ? WIDTH - tileX * TILE_SIZE : TILE_SIZE;
      const height = tileY === rows - 1 ? HEIGHT - tileY * TILE_SIZE : TILE_SIZE;
      const cells = [];
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          cells.push((tileX * 3 + tileY * 5 + x + y * 2) % STRIPE_PALETTE.length);
        }
      }
      tiles.push({ tile_x: tileX, tile_y: tileY, width, height, cells });
    }
  }
  const createResponse = await page.request.post('/api/colorings/create', {
    data: {
      title: 'P0 final acceptance 1200',
      storageMode: 'tiled',
      width: WIDTH,
      height: HEIGHT,
      tileSize: TILE_SIZE,
      palette: STRIPE_PALETTE,
      tiles,
    },
    timeout: 60000,
  });
  expect(createResponse.ok()).toBe(true);
  const created = await createResponse.json();

  // Simulate existing progress by painting one tile directly through the
  // server-authoritative action contract. The batch uses the REAL target
  // colors from the tile payload so the server accepts it. Global indices
  // 0..31 all sit inside tile (0,0), where tile-local == global index.
  const tile0 = await page.request.get(`/api/colorings/${created.id}/tiles/0/0`, {
    headers: { 'X-User-Id': TEST_USER },
  });
  expect(tile0.ok()).toBe(true);
  const tile0Body = await tile0.json();
  const progress = await page.request.get(`/api/colorings/${created.id}/progress`, {
    headers: { 'X-User-Id': TEST_USER },
  });
  const progressBody = await progress.json();
  const batch = [];
  for (let index = 0; index < 32; index += 1) {
    batch.push({ index, color: tile0Body.cells[index] });
  }
  const paint = await page.request.post(`/api/colorings/${created.id}/progress/actions`, {
    headers: { 'X-User-Id': TEST_USER, 'Content-Type': 'application/json' },
    data: { changes: batch, revision: progressBody.revision, clientBatchId: `p0-evidence-${Date.now()}` },
  });
  expect(paint.status()).toBe(200);
  const painted = await paint.json();
  expect(Number(painted.completed_cells)).toBeGreaterThan(0);

  // COLD START: fresh page, no tile cache, nothing clicked.
  await page.goto(`/?coloring=${created.id}`);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toBeVisible({ timeout: 20000 });

  // The engine itself lands on a small working area.
  await expect.poll(
    () => session.getAttribute('data-smart-state'),
    { timeout: 25000 },
  ).toBe('ready');
  const gridArea = page.locator('.progressive-grid-area');
  const camera = {
    x: Number(await gridArea.getAttribute('data-camera-x')),
    y: Number(await gridArea.getAttribute('data-camera-y')),
    zoom: Number(await gridArea.getAttribute('data-camera-zoom')),
  };
  expect(camera.zoom).toBeGreaterThanOrEqual(0.4);

  const targetX = Number(await session.getAttribute('data-smart-target-x'));
  const targetY = Number(await session.getAttribute('data-smart-target-y'));
  expect(Number.isInteger(targetX) && Number.isInteger(targetY)).toBe(true);

  // No central "Обзор карты" card, no failure message.
  await expect(page.locator('.progressive-grid-preview')).toHaveCount(0);
  await expect(page.locator('.progressive-grid-input-notice')).toHaveCount(0);
  await expect(page.locator('[data-smart-error="true"]')).toHaveCount(0);

  // Screenshot BEFORE the first interaction: the working area is on screen.
  await page.waitForTimeout(600);
  await page.screenshot({
    path: join(EVIDENCE_DIR, 'p0-final-acceptance.png'),
    fullPage: false,
  });

  // The FIRST user action is PAINT (tap the suggested anchor cell).
  const box = await gridArea.boundingBox();
  const anchorX = box.x + camera.x + (targetX + 0.5) * TILE_SIZE * camera.zoom;
  const anchorY = box.y + camera.y + (targetY + 0.5) * TILE_SIZE * camera.zoom;
  await page.mouse.move(anchorX, anchorY);
  const progressAction = page.waitForResponse(
    (response) => response.url().includes('/progress/actions') && response.request().method() === 'POST',
  );
  await page.mouse.down();
  await page.mouse.up();
  const saved = await progressAction;
  expect(saved.status()).toBe(200);
  expect(Number((await saved.json()).completed_cells)).toBeGreaterThan(Number(painted.completed_cells));

  // Screenshot AFTER the first paint.
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(EVIDENCE_DIR, 'p0-after-first-paint.png'),
    fullPage: false,
  });

  console.log(`EVIDENCE saved: ${join(EVIDENCE_DIR, 'p0-final-acceptance.png')}`);
});
