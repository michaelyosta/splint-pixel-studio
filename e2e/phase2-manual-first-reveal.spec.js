import { test, expect } from '@playwright/test';

test('Phase 2 keeps the first reveal player-authored before any special event', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(testInfo.project.name.toLowerCase().includes('webkit'), 'Canvas delivery verifier targets Chromium/WebView-like projects');
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });
  const userId = `e2e_phase2_manual_${testInfo.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': userId });
  const seeded = await page.request.post('/api/__e2e/seed-cohort-template', {
    data: { cohort: 'treatment', storage: 'tiled', size: { width: 64, height: 64 } },
  });
  expect(seeded.ok()).toBe(true);
  const fixture = await seeded.json();
  const guidanceRequest = page.waitForRequest((request) => (
    request.url().includes(`/api/colorings/${fixture.id}/guidance`)
      && request.url().includes('session_game=1')
  ));
  await page.goto(`/?coloring=${fixture.id}&phase2=session&phase2Variant=treatment&phase2Event=spark_choice&phase2Subject=phase2_${testInfo.project.name.toLowerCase()}_manual`);
  await expect(page.locator('.progressive-coloring-session[data-smart-state="ready"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-session-game-spark]')).toHaveCount(0);
  await expect(page.locator('[data-special-offer-kind]')).toHaveAttribute('data-special-offer-kind', '', { timeout: 5_000 });
  await guidanceRequest;

  const state = await page.locator('.progressive-coloring-session').evaluate((element) => ({
    cameraX: Number(element.getAttribute('data-camera-x')),
    cameraY: Number(element.getAttribute('data-camera-y')),
    cameraZoom: Number(element.getAttribute('data-camera-zoom')),
    targetMinX: Number(element.getAttribute('data-smart-target-min-x')),
    targetMinY: Number(element.getAttribute('data-smart-target-min-y')),
    targetMaxX: Number(element.getAttribute('data-smart-target-max-x')),
    targetMaxY: Number(element.getAttribute('data-smart-target-max-y')),
  }));
  const canvas = page.locator('canvas[aria-label^="Поле раскраски"]');
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  const zoom = state.cameraZoom || 1;
  const cellSize = 32;
  const toScreen = (cellX, cellY) => ({
    x: box.x + state.cameraX + (cellX + 0.5) * cellSize * zoom,
    y: box.y + state.cameraY + (cellY + 0.5) * cellSize * zoom,
  });
  const minX = state.targetMinX;
  const minY = state.targetMinY;
  const maxX = state.targetMaxX;
  const maxY = state.targetMaxY;
  expect([minX, minY, maxX, maxY].every(Number.isFinite)).toBe(true);
  const start = toScreen(minX, minY);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let row = minY; row <= maxY; row += 1) {
    const fromX = row % 2 === 0 ? minX : maxX;
    const toX = row % 2 === 0 ? maxX : minX;
    await page.mouse.move(toScreen(fromX, row).x, toScreen(fromX, row).y);
    await page.mouse.move(toScreen(toX, row).x, toScreen(toX, row).y);
  }
  await page.mouse.up();
  await expect(page.locator('[data-session-game-specials-armed="true"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-guide-target-remaining="0"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-reveal-ceremony-kind="fragment"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-session-game-spark]')).toHaveCount(0);
  expect(pageErrors, pageErrors.map((error) => error.stack || error.message).join('\n')).toHaveLength(0);
});
