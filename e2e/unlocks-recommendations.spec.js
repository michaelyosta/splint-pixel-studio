import { test, expect } from '@playwright/test';

const RECOMMENDATION_CODES = new Set([
  'CONTINUE_PROGRESS',
  'THEME_AFFINITY',
  'COLLECTION_AFFINITY',
  'DIFFICULTY_MATCH',
  'DAILY_FEATURED',
  'COLD_START',
]);

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

async function openHome(page) {
  await page.goto('/');
  await expect(page.locator('.home-page')).toBeVisible({ timeout: 15000 });
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

  test('cold-start recommendations render stable reason text in bounded cards', async ({ page }) => {
    await openHome(page);
    const strip = page.locator('[data-recommendations="true"]');
    await expect(strip).toBeVisible();
    await expect(page.locator('[data-recommendations-status="loading"]')).toHaveCount(0, { timeout: 15000 });

    const scroll = strip.locator('[data-recommendations-count]');
    await expect(scroll).toBeVisible({ timeout: 10000 });
    const count = Number(await scroll.getAttribute('data-recommendations-count')) || 0;
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(8);

    const cards = strip.locator('[data-recommendation-id]');
    await expect(cards).toHaveCount(count);
    for (let index = 0; index < count; index += 1) {
      const reason = await cards.nth(index).getAttribute('data-reason-code');
      expect(RECOMMENDATION_CODES.has(reason)).toBe(true);
      await expect(cards.nth(index)).toContainText(/Продолжите начатую раскраску|Похоже на ваши любимые темы|Из коллекции, которую вы раскрашиваете|Подходит по сложности|Выбор дня|Новое для вас/);
    }
    const bounded = await page.evaluate(() => ({
      perCellDom: document.querySelectorAll('[data-cell-index], .coloring-cell').length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    }));
    expect(bounded.perCellDom).toBe(0);
    expect(bounded.overflow).toBe(false);

    const journey = page.locator('[data-unlock-journey="true"]');
    await expect(journey).toBeVisible();
    await expect(page.locator('[data-journey-status="loading"]')).toHaveCount(0, { timeout: 15000 });
  });

  test('progression-locked direct ID opens an actionable locked screen, not a generic error', async ({ page }) => {
    await openDirectId(page, 'color_starter_night');
    const locked = page.locator('[data-unlock-locked="true"]');
    await expect(locked).toBeVisible({ timeout: 10000 });
    await expect(locked).toHaveAttribute('data-locked-state', 'progression_locked');
    await expect(locked).toHaveAttribute('data-locked-reason', 'PROGRESSION_REQUIRED');
    await expect(locked.locator('[data-requirement-type="level"]')).toBeVisible();
    await expect(locked.locator('[data-requirement-type="completed_artworks"]')).toBeVisible();
    await expect(locked).toContainText('К следующей цели');
    await expect(locked).toContainText('В каталог');
    await expect(page.locator('.player-page')).toHaveCount(0);
    await expect(page.locator('.toast')).toHaveCount(0);

    await locked.getByRole('button', { name: 'В каталог', exact: true }).click();
    await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 10000 });
  });

  test('premium direct ID shows a neutral unavailable state without payment CTA', async ({ page }) => {
    await openDirectId(page, 'color_premium_whale');
    const locked = page.locator('[data-unlock-locked="true"]');
    await expect(locked).toBeVisible({ timeout: 10000 });
    await expect(locked).toHaveAttribute('data-locked-state', 'premium_locked');
    await expect(locked).toHaveAttribute('data-locked-reason', 'PREMIUM_REQUIRED');
    await expect(locked.locator('[data-requirement-type="premium"]')).toBeVisible();
    await expect(locked).toContainText('Контент сейчас недоступен');
    await expect(locked).not.toContainText(/Premium|Премиум|Stars|витрин|купить|покупк/i);
    await expect(locked.getByRole('button', { name: /Как купить Premium/i })).toHaveCount(0);
    await expect(locked.getByRole('button', { name: 'В каталог', exact: true })).toBeVisible();

    await locked.getByRole('button', { name: 'В каталог', exact: true }).click();
    await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.catalog-chips')).not.toContainText(/Premium|Премиум|Stars|витрин/i);
  });

  test('eligible user gets an actionable direct-ID open and owned transition', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'seeded owned transition runs once on Chromium');
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

    await openHome(page);
    const recommendations = await (await recommendationsResponse).json();
    const unlock = await (await unlockResponse).json();

    expect(Number(recommendations.candidates_evaluated)).toBeLessThanOrEqual(200);
    expect(recommendations.recommendations.length).toBeLessThanOrEqual(8);
    expect(recommendations.recommendations.every((item) => !('cells' in item) && !('filled' in item))).toBe(true);
    expect(recommendations.recommendations.some((item) => item.id === coloringId)).toBe(false);

    expect(JSON.stringify(unlock).length).toBeLessThan(1_000_000);
    const subjects = [...(unlock.collections || []), ...(unlock.templates || [])];
    expect(subjects.every((item) => !('cells' in item) && !('filled' in item))).toBe(true);

    const strip = page.locator('[data-recommendations="true"]');
    await expect(page.locator('[data-recommendations-status="loading"]')).toHaveCount(0, { timeout: 15000 });
    const scroll = strip.locator('[data-recommendations-count]');
    await expect(scroll).toBeVisible({ timeout: 10000 });
    const count = Number(await scroll.getAttribute('data-recommendations-count')) || 0;
    expect(count).toBeLessThanOrEqual(8);
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
