import { test, expect } from '@playwright/test';

const viewportMatrix = [
  { width: 390, height: 844, label: 'browser mobile' },
  { width: 430, height: 932, label: 'browser large mobile' },
  { width: 768, height: 1024, label: 'browser tablet' },
  { width: 1024, height: 768, label: 'browser small desktop' },
  { width: 1280, height: 800, label: 'browser desktop' },
  { width: 1440, height: 900, label: 'browser wide desktop' },
];

test('Catalog/Create/Profile shell has no horizontal overflow across the responsive matrix', async ({ page }) => {
  for (const size of viewportMatrix) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/');
    await expect(page.locator('.app-tab-bar')).toBeVisible();
    await expect(page.locator('.app-tab-bar > button')).toHaveCount(3);
    await expect(page.locator('.catalog-art-grid').first()).toBeAttached();
    const metrics = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      frameWidth: document.querySelector('.telegram-frame')?.getBoundingClientRect().width || 0,
      gridColumns: getComputedStyle(document.querySelector('.catalog-art-grid')).gridTemplateColumns,
    }));
    expect(metrics.documentWidth, size.label).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.bodyWidth, size.label).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(Math.round(metrics.frameWidth), size.label).toBe(size.width);
    if (size.width >= 768) expect(metrics.gridColumns.split(' ').length, size.label).toBeGreaterThanOrEqual(2);
  }
});

test('Telegram wide-host stub uses the platform adapter without showing browser login', async ({ page }) => {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.Telegram = { WebApp: { platform: 'tdesktop', initData: '', initDataUnsafe: {}, ready() {}, expand() {} } };`,
  }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('[data-browser-auth-page]')).toHaveCount(0);
  await expect(page.locator('.telegram-frame')).toHaveAttribute('data-platform', 'telegram');
  await expect(page.locator('.app-tab-bar > button')).toHaveCount(3);
});
