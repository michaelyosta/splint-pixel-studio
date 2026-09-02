import { test, expect } from '@playwright/test';

async function primeLocalStorage(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('splint_onboarding_version', '2');
    } catch {
      // Storage may be unavailable in some contexts.
    }
  });
}

async function useUser(page, testInfo) {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': `e2e_unlocks_${testInfo.testId}` });
  await primeLocalStorage(page);
}

async function openCatalog(page) {
  await page.goto('/');
  await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 15000 });
}

async function openDirectId(page, coloringId) {
  await page.goto(`/?coloring=${encodeURIComponent(coloringId)}`);
}

async function createAndCompleteEligibleColoring(page) {
  const width = 32;
  const height = 32;
  const palette = ['#0B1522', '#2BD9FE'];
  const cells = new Array(width * height).fill(0);
  const create = await page.request.post('/api/colorings/create', {
    data: {
      title: 'Eligible seed',
      description: 'Deterministic level + completed artwork seed',
      width,
      height,
      palette,
      cells,
      tileSize: 32,
    },
  });
  expect(create.ok()).toBe(true);
  const created = await create.json();
  expect(created.id).toMatch(/^color_/);

  let revision = 0;
  for (let offset = 0; offset < width * height; offset += 64) {
    const count = Math.min(64, width * height - offset);
    const changes = Array.from({ length: count }, (_, index) => ({ index: offset + index, color: 0 }));
    const response = await page.request.post(`/api/colorings/${created.id}/progress/actions`, {
      data: { changes, revision, clientBatchId: `e2e-seed-${offset}` },
    });
    expect(response.ok()).toBe(true);
    const saved = await response.json();
    revision = Number(saved.revision);
  }
  return created.id;
}

async function createTiled1200(page) {
  const tileSize = 32;
  const tilesX = Math.ceil(1200 / tileSize);
  const tilesY = Math.ceil(1200 / tileSize);
  const tiles = [];
  for (let tileY = 0; tileY < tilesY; tileY += 1) {
    for (let tileX = 0; tileX < tilesX; tileX += 1) {
      const width = Math.min(tileSize, 1200 - tileX * tileSize);
      const height = Math.min(tileSize, 1200 - tileY * tileSize);
      tiles.push({ tile_x: tileX, tile_y: tileY, cells: new Array(width * height).fill(0) });
    }
  }
  const create = await page.request.post('/api/colorings/create', {
    data: {
      title: 'Tiled 1200 boundedness',
      description: 'Bounded recommendation history seed',
      width: 1200,
      height: 1200,
      palette: ['#0B1522', '#2BD9FE'],
      tiles,
      tileSize,
      storageMode: 'tiled',
    },
  });
  expect(create.ok()).toBe(true);
  const created = await create.json();
  expect(created.storage_mode).toBe('tiled');
  return created.id;
}

async function paintTiledCells(page, coloringId, count = 4) {
  const progressResponse = await page.request.get(`/api/colorings/${coloringId}/progress`);
  expect(progressResponse.ok()).toBe(true);
  const progress = await progressResponse.json();
  const changes = Array.from({ length: count }, (_, index) => ({ index, color: 0 }));
  const action = await page.request.post(`/api/colorings/${coloringId}/progress/actions`, {
    data: { changes, revision: Number(progress.revision || 0), clientBatchId: 'e2e-tiled-bounded' },
  });
  expect(action.ok()).toBe(true);
  const saved = await action.json();
  expect(Number(saved.completed_cells)).toBeGreaterThan(0);
  expect(Number(saved.total_cells)).toBe(1_440_000);
}

test.describe('Unlocks and recommendations', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await useUser(page, testInfo);
  });

  test('cold-start catalog stays artwork-first while recommendation data remains bounded and dormant', async ({ page }) => {
    const unlockResponse = page.waitForResponse(
      (response) => response.url().includes('/api/unlocks/me'),
    );
    const recommendationsResponse = page.waitForResponse(
      (response) => response.url().includes('/api/colorings/recommendations'),
    );
    await openCatalog(page);
    expect((await unlockResponse).status()).toBe(200);
    expect((await recommendationsResponse).status()).toBe(200);
    await expect(page.locator('.catalog-art-card').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-recommendations="true"], [data-unlock-journey="true"]')).toHaveCount(0);
    const bounded = await page.evaluate(() => ({
      perCellDom: document.querySelectorAll('[data-cell-index], .coloring-cell').length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    }));
    expect(bounded.perCellDom).toBe(0);
    expect(bounded.overflow).toBe(false);

  });

  test('legacy progression-locked direct ID stays fail-closed without progression UX', async ({ page }) => {
    await openDirectId(page, 'color_starter_night');
    const locked = page.locator('[data-unlock-locked="true"]');
    await expect(locked).toBeVisible({ timeout: 10000 });
    await expect(locked).toHaveAttribute('data-locked-state', 'progression_locked');
    await expect(locked).toHaveAttribute('data-locked-reason', 'PROGRESSION_REQUIRED');
    await expect(locked.locator('[data-requirement-type], [role="progressbar"]')).toHaveCount(0);
    await expect(locked).not.toContainText(/XP|уровень|серия|достижение|следующая цель/i);
    await expect(locked).toContainText('Выбрать доступную картину');
    await expect(locked).toContainText('В каталог');
    await expect(page.locator('.player-page')).toHaveCount(0);
    await expect(page.locator('.toast')).toHaveCount(0);

    await locked.getByRole('button', { name: 'В каталог', exact: true }).click();
    await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 10000 });
  });

  test('normal collection navigation hides premium entries from collection surfaces', async ({ page }) => {
    await openCatalog(page);
    const rawCollectionsResponse = await page.request.get('/api/meta/collections');
    expect(rawCollectionsResponse.ok()).toBe(true);
    const rawCollections = await rawCollectionsResponse.json();
    expect(rawCollections.some((collection) => collection.pack_type === 'premium')).toBe(true);
    const freeCollections = rawCollections.filter((collection) => collection.pack_type !== 'premium');

    await page.locator('.catalog-chips').getByRole('tab', { name: 'Коллекции', exact: true }).click();
    await expect(page.locator('.catalog-collection-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.catalog-collection-card')).toHaveCount(freeCollections.length);
    await expect(page.locator('.catalog-collection-grid')).not.toContainText(/Premium|Премиум|Stars|витрин|купить|покупк/i);

    await page.getByRole('button', { name: 'Профиль', exact: true }).first().click();
    await expect(page.locator('.profile-page--showcase')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.profile-collection-list')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.profile-collection-list')).not.toContainText(/Premium|Премиум|Stars|витрин|купить|покупк/i);

    await page.getByRole('button', { name: 'Каталог', exact: true }).first().click();
    await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 10000 });
    // Phase 5 deliberately exposes one bounded showcase entry in the Catalog;
    // premium artwork itself must still stay out of the free collection list.
    await expect(page.locator('.catalog-chips')).not.toContainText(/Premium|Премиум|Stars|купить|покупк/i);
  });

  test('premium direct ID shows a neutral unavailable state without payment CTA', async ({ page }) => {
    await openDirectId(page, 'color_premium_whale');
    const locked = page.locator('[data-unlock-locked="true"]');
    await expect(locked).toBeVisible({ timeout: 10000 });
    await expect(locked).toHaveAttribute('data-locked-state', 'premium_locked');
    await expect(locked).toHaveAttribute('data-locked-reason', 'PREMIUM_REQUIRED');
    await expect(locked.locator('[data-requirement-type="premium"]')).toHaveCount(1);
    await expect(locked).toHaveAttribute('data-locked-requirement-count', '1');
    await expect(locked.locator('[role="progressbar"]')).toHaveCount(0);
    await expect(locked).not.toContainText(/\d+%/);
    await expect(locked).toContainText('Эта работа пока недоступна');
    // The unavailable state may explain that purchase is not connected yet;
    // it must not present a production payment CTA or claim ownership.
    await expect(locked).not.toContainText(/Premium|Премиум|Stars|витрин/i);
    await expect(locked).toContainText('Покупка пока не подключена');
    await expect(locked.getByRole('button', { name: /Как купить Premium/i })).toHaveCount(0);
    await expect(locked.getByRole('button', { name: 'В каталог', exact: true })).toBeVisible();

    await locked.getByRole('button', { name: 'В каталог', exact: true }).click();
    await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.catalog-chips')).not.toContainText(/Premium|Премиум|Stars/i);
  });

  test('catalog showcase stays fail-closed without a mounted payment adapter', async ({ page }) => {
    await openCatalog(page);
    await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 10000 });
    await page.locator('[data-premium-pack-teaser="true"]').click();
    const showcase = page.locator('[data-premium-pack="true"]');
    await expect(showcase).toBeVisible({ timeout: 10000 });
    await expect(showcase).toHaveAttribute('data-premium-state', 'unavailable', { timeout: 15000 });
    await expect(showcase.getByRole('button', { name: /Запросить доступ/i })).toHaveCount(0);
    await expect(showcase.locator('[data-premium-primary-action="true"]')).toContainText(/Сохранить желание|Желание сохранено/);
  });

  test('eligible user gets an actionable direct-ID open and owned transition', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'seeded owned transition runs once on Chromium');
    test.setTimeout(180000);
    await createAndCompleteEligibleColoring(page);

    const before = await page.request.get('/api/unlocks/collections/col_starter-path');
    expect(before.ok()).toBe(true);
    const beforeState = await before.json();
    expect(beforeState.state).toBe('available');
    expect(beforeState.grant_required).toBe(true);

    await openDirectId(page, 'color_starter_night');
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-unlock-locked="true"]')).toHaveCount(0);

    const after = await page.request.get('/api/unlocks/collections/col_starter-path');
    expect(after.ok()).toBe(true);
    const afterState = await after.json();
    expect(afterState.state).toBe('owned');
    expect(afterState.owned).toBe(true);
  });

  test('1200 in-progress history keeps recommendations and unlock state bounded', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', '1200 bounded gate runs once on Chromium');
    const coloringId = await createTiled1200(page);
    await paintTiledCells(page, coloringId, 4);

    let tilesOrManifestRequests = 0;
    const recommendationsResponse = page.waitForResponse(
      (response) => response.url().includes('/api/colorings/recommendations'),
    );
    const unlockResponse = page.waitForResponse(
      (response) => response.url().includes('/api/unlocks/me'),
    );
    page.on('request', (request) => {
      if (/\/api\/colorings\/[^/]+\/(tiles\/|manifest)/.test(request.url())) tilesOrManifestRequests += 1;
    });

    await openCatalog(page);
    const recommendations = await (await recommendationsResponse).json();
    const unlock = await (await unlockResponse).json();

    expect(Number(recommendations.candidates_evaluated)).toBeLessThanOrEqual(200);
    expect(recommendations.recommendations.length).toBeLessThanOrEqual(8);
    expect(recommendations.recommendations.every((item) => !('cells' in item) && !('filled' in item))).toBe(true);
    expect(recommendations.recommendations.some((item) => item.id === coloringId)).toBe(false);

    expect(JSON.stringify(unlock).length).toBeLessThan(1_000_000);
    const subjects = [...(unlock.collections || []), ...(unlock.templates || [])];
    expect(subjects.every((item) => !('cells' in item) && !('filled' in item))).toBe(true);

    await expect(page.locator('[data-recommendations="true"]')).toHaveCount(0);
    const bounded = await page.evaluate(() => ({
      perCellDom: document.querySelectorAll('[data-cell-index], .coloring-cell').length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      recommendationCards: document.querySelectorAll('[data-recommendation-id]').length,
    }));
    expect(bounded.perCellDom).toBe(0);
    expect(bounded.recommendationCards).toBeLessThanOrEqual(8);
    expect(bounded.overflow).toBe(false);
    expect(tilesOrManifestRequests).toBe(0);
  });
});
