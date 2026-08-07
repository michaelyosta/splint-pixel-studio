import { test, expect } from '@playwright/test';

test('tiled completion shows the completion overlay in the player', async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': 'e2e_tiled_complete_1' });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });
  await page.route('https://telegram.org/js/telegram-web-app.js', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: 'window.Telegram = window.Telegram || { WebApp: { ready() {} } };',
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });

  // A tiny tiled template exercises the exact same storage, progress,
  // artwork, and completion contract as 1200x1200 without a long e2e walk.
  const createResponse = await page.request.post('/api/colorings/create', {
    data: {
      title: 'Tiled completion e2e',
      storageMode: 'tiled',
      width: 8,
      height: 8,
      tileSize: 32,
      palette: ['#101820', '#ffffff'],
      tiles: [{ tile_x: 0, tile_y: 0, width: 8, height: 8, cells: Array(64).fill(0) }],
    },
  });
  expect(createResponse.ok()).toBe(true);
  const created = await createResponse.json();
  expect(created.storage_mode).toBe('tiled');

  const completeResponse = await page.request.post(`/api/colorings/${created.id}/progress/actions`, {
    data: {
      revision: 0,
      clientBatchId: 'tiled-completion-e2e-001',
      changes: Array.from({ length: 64 }, (_, index) => ({ index, color: 0 })),
    },
  });
  expect(completeResponse.ok()).toBe(true);
  const completed = await completeResponse.json();
  expect(completed.percent).toBe(100);
  expect(completed.artwork_id).toBeTruthy();
  // Completion commits progress + artwork metadata + the render job and
  // returns immediately; the outbox worker renders outside the transaction.
  expect(completed.render_status).toBe('pending');

  await expect
    .poll(async () => {
      const progressResponse = await page.request.get(`/api/colorings/${created.id}/progress`);
      if (!progressResponse.ok()) return null;
      const progress = await progressResponse.json();
      return progress.render_status === 'ready' ? progress : null;
    }, { timeout: 15000 })
    .not.toBeNull();

  await page.goto(`/?coloring=${created.id}`);
  await expect(page.locator('.progressive-coloring-session')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.completion-overlay')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.completion-dialog')).toBeVisible();
  await expect(page.locator('#completion-title')).toContainText('Картина раскрыта');
  await expect(page.locator('.completion-links button:has-text("Опубликовать")')).toBeVisible();
  await expect(page.locator('.completion-actions button:has-text("Сохранить результат")')).toBeVisible();
});
