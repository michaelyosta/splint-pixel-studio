import { test, expect } from '@playwright/test';

async function primeCatalog(page, testInfo) {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': `e2e_merchandising_${testInfo.testId}` });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch { /* restricted storage is valid */ }
  });
}

async function acquireLocalPremiumGallery(page, userId) {
  // This exercises the development-only internal-credit ledger in the
  // disposable E2E database. It never creates an invoice or a real payment.
  for (let grant = 0; grant < 2; grant += 1) {
    const topUp = await page.request.post(`/api/users/${encodeURIComponent(userId)}/add-stars`);
    expect(topUp.ok()).toBe(true);
  }
  const purchase = await page.request.post('/api/users/collections/col_premium-gallery/add', {
    headers: { 'Idempotency-Key': `merchandising-owned-${userId}` },
  });
  expect(purchase.ok()).toBe(true);
  const entitlement = await page.request.get('/api/unlocks/collections/col_premium-gallery');
  expect(entitlement.ok()).toBe(true);
  expect(await entitlement.json()).toMatchObject({ state: 'owned', owned: true });
}

test.describe('Catalog merchandising release', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await primeCatalog(page, testInfo);
  });

  test('merchandising catalog exposes shelves and the Collection > Album hierarchy', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-catalog-hero]')).toContainText('320 сцен');
    await expect(page.locator('.catalog-shelf')).toHaveCount(9, { timeout: 15000 });
    await expect(page.locator('[data-shelf-id="new"]')).toBeVisible();
    await expect(page.locator('[data-shelf-id="free"]')).toContainText('172');
    await expect(page.locator('[data-shelf-id="premium"]')).toContainText('148');

    await page.getByRole('tab', { name: 'Коллекции', exact: true }).click();
    const collections = page.locator('.catalog-collection-grid[aria-label="Коллекции каталога"]');
    await expect(collections).toBeVisible();
    await expect(collections.locator('.catalog-collection-card')).toHaveCount(16);
    const modernCollection = collections.locator('.catalog-collection-card').filter({ hasText: 'Blockbound Worlds' });
    await expect(modernCollection).toContainText('2 альбома');
    await expect(modernCollection).toContainText('20 работ');
    await modernCollection.click();
    await expect(page.locator('.catalog-art-grid')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.catalog-heading h1')).toHaveText('Blockbound Worlds');
    await expect(page.locator('.catalog-art-card')).toHaveCount(12);
    await page.getByRole('button', { name: /Показать ещё \(8\)/ }).click();
    await expect(page.locator('.catalog-art-card')).toHaveCount(20);
  });

  test('Premium Gallery presents the complete value proposition and stops at payment boundary', async ({ page }) => {
    await page.route('**/api/payments/telegram-stars/config', async (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mode: 'telegram_stars_controlled', product_ids: ['col_premium-gallery'] }),
    }));
    await page.goto('/');
    await page.locator('[data-premium-pack-teaser="true"]').click();
    const showcase = page.locator('[data-premium-pack="true"]');
    await expect(showcase).toHaveAttribute('data-premium-state', 'paid', { timeout: 15000 });
    await expect(showcase).toContainText('148 работ');
    await expect(showcase).toContainText('120 Stars');
    await expect(showcase.locator('.premium-pack-items .premium-pack-item')).toHaveCount(6);
    await expect(showcase).toContainText('Яркие миры, неон, существа и атмосферные сцены');

    await showcase.getByRole('button', { name: /Купить набор · 120 Stars/i }).click();
    await expect(page.locator('[data-store-page]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-pack-id="col_premium-gallery"]')).toContainText('120');
    await expect(page.locator('[data-pack-id="col_premium-gallery"]')).toContainText('купить в Telegram');
  });

  test('owned Premium artwork opens directly from catalog shelves and collection grids', async ({ page }, testInfo) => {
    const userId = `e2e_merchandising_${testInfo.testId}`;
    await acquireLocalPremiumGallery(page, userId);
    await page.goto('/');
    await expect(page.locator('[data-premium-pack-teaser]')).toHaveAttribute('data-premium-state', 'owned');
    const shelfCard = page.locator('[data-shelf-id="premium"] .catalog-shelf-card').nth(7);
    await expect(shelfCard).toBeVisible();
    const title = await shelfCard.locator('.catalog-shelf-title').innerText();
    const list = await page.request.get('/api/colorings?access=premium&limit=500');
    expect(list.ok()).toBe(true);
    const artwork = (await list.json()).find(item => item.title === title);
    expect(artwork?.id).toBeTruthy();
    const before = await page.request.get(`/api/colorings/${artwork.id}/progress`);
    expect(before.ok()).toBe(true);
    expect((await before.json()).completed_cells).toBe(0);
    const opened = page.waitForResponse(response => response.url().includes(`/colorings/${artwork.id}/progress`) && response.request().method() === 'GET');
    await shelfCard.locator('.catalog-shelf-open').click();
    expect((await opened).ok()).toBe(true);
    await expect(page.locator('.player-page')).toBeVisible();
    await expect(page.locator('[data-premium-pack]')).toHaveCount(0);

    // Reload the untouched owner session and check the other shared card path.
    await page.goto('/');
    await page.getByRole('tab', { name: 'Коллекции', exact: true }).click();
    await page.locator('.catalog-collection-grid[aria-label="Коллекции каталога"] .catalog-collection-card').filter({ hasText: 'Dreamcore Idols' }).click();
    const gridCard = page.locator('.catalog-art-card[data-access="premium"]').nth(7);
    await expect(gridCard).toBeVisible();
    const gridTitle = await gridCard.locator('.catalog-art-copy b').innerText();
    await expect(gridCard.locator('.catalog-art-open')).toHaveAttribute('aria-label', `Открыть раскраску ${gridTitle}`);
    await gridCard.locator('.catalog-art-open').click();
    await expect(page.locator('.player-page')).toBeVisible();
    await expect(page.locator('[data-premium-pack]')).toHaveCount(0);
  });

  test('unowned Premium collection cards stay badged and open the showcase', async ({ page }) => {
    const templates = await page.request.get('/api/meta/collections/col_dreamcore-idols/templates');
    expect(templates.ok()).toBe(true);
    const items = await templates.json();
    expect(items).toHaveLength(20);
    expect(items.every(item => item.access === 'premium' && item.access_type === 'premium')).toBe(true);
    const denied = await page.request.get(`/api/colorings/${items[7].id}/progress`);
    expect(denied.status()).toBe(403);
    expect(await denied.json()).toMatchObject({ code: 'PREMIUM_REQUIRED' });
    await page.goto('/');
    await page.getByRole('tab', { name: 'Коллекции', exact: true }).click();
    await page.locator('.catalog-collection-grid[aria-label="Коллекции каталога"] .catalog-collection-card').filter({ hasText: 'Dreamcore Idols' }).click();
    await expect(page.locator('.catalog-art-card[data-access="premium"]')).toHaveCount(12);
    await expect(page.locator('.catalog-art-premium-badge')).toHaveCount(12);
    const card = page.locator('.catalog-art-card').nth(7);
    await expect(card.locator('.catalog-art-open')).toHaveAttribute('aria-label', /Открыть витрину Premium Gallery/);
    await card.locator('.catalog-art-open').click();
    await expect(page.locator('[data-premium-pack]')).toHaveAttribute('data-premium-entitlement', 'not-owned');
    await expect(page.locator('.player-page')).toHaveCount(0);
  });
});
