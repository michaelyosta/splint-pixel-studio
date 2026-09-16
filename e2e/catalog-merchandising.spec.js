import { test, expect } from '@playwright/test';

async function primeCatalog(page, testInfo) {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': `e2e_merchandising_${testInfo.testId}` });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch { /* restricted storage is valid */ }
  });
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

    await showcase.getByRole('button', { name: /Запросить доступ · 120 Stars/i }).click();
    await expect(page.locator('[data-store-page]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-pack-id="col_premium-gallery"]')).toContainText('120');
    await expect(page.locator('[data-pack-id="col_premium-gallery"]')).toContainText('купить в Telegram');
  });
});
