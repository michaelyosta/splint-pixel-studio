import { test, expect } from '@playwright/test';

const viewportMatrix = [
  { width: 390, height: 844, label: 'browser mobile' },
  { width: 430, height: 932, label: 'browser large mobile' },
  { width: 768, height: 1024, label: 'browser tablet' },
  { width: 1024, height: 768, label: 'browser small desktop' },
  { width: 1280, height: 800, label: 'browser desktop' },
  { width: 1440, height: 900, label: 'browser wide desktop' },
];

// The bottom navigation must stay painted and reachable after the host grows
// the viewport (Telegram sheet -> full screen). A bar that still receives taps
// while its layer is not repainted is the regression this guards.
async function expectNavigationPainted(page, label) {
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' });
  await expect(navigation, label).toBeVisible();
  await expect(navigation.getByRole('button'), label).toHaveCount(3);
  const painted = await navigation.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const buttonsReachPointer = [...element.querySelectorAll('button')].every((button) => {
      const buttonRect = button.getBoundingClientRect();
      if (buttonRect.width <= 0 || buttonRect.height <= 0) return false;
      const hit = document.elementFromPoint(
        buttonRect.left + buttonRect.width / 2,
        buttonRect.top + buttonRect.height / 2,
      );
      return hit === button || button.contains(hit);
    });
    return {
      width: rect.width,
      height: rect.height,
      display: style.display,
      visibility: style.visibility,
      opacity: Number(style.opacity),
      withinViewport: rect.top >= 0 && rect.bottom <= window.innerHeight + 1,
      buttonsReachPointer,
    };
  });
  expect(painted.width, label).toBeGreaterThan(0);
  expect(painted.height, label).toBeGreaterThan(0);
  expect(painted.display, label).not.toBe('none');
  expect(painted.visibility, label).toBe('visible');
  expect(painted.opacity, label).toBeGreaterThan(0);
  expect(painted.withinViewport, label).toBe(true);
  expect(painted.buttonsReachPointer, label).toBe(true);
}

test('Catalog/Create/Profile shell has no horizontal overflow across the responsive matrix', async ({ page }, testInfo) => {
  for (const size of viewportMatrix) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/');
    await expect(page.locator('.app-tab-bar')).toBeVisible();
    await expect(page.locator('.app-tab-bar > button')).toHaveCount(3);
    await expectNavigationPainted(page, size.label);
    await page.locator('[data-catalog-all-works-toggle="true"]').click({ timeout: 15000 });
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

  // Same shell, but through the host viewport growth that used to leave the
  // navigation painted nowhere while its buttons still received taps.
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' });
  for (const height of [640, 844]) {
    await page.setViewportSize({ width: 400, height });
    await page.goto('/');
    await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 15000 });
    await expectNavigationPainted(page, `catalog@400x${height}`);
    await page.screenshot({ path: testInfo.outputPath(`navigation-${height}-catalog.png`) });

    await navigation.getByRole('button', { name: 'Создать' }).click();
    await expect(page.locator('.create-hub-page')).toBeVisible();
    await expectNavigationPainted(page, `create@400x${height}`);

    await navigation.getByRole('button', { name: 'Профиль' }).click();
    await expect(page.locator('[data-profile-showcase]')).toBeVisible({ timeout: 15000 });
    await expectNavigationPainted(page, `profile@400x${height}`);
    await page.screenshot({ path: testInfo.outputPath(`navigation-${height}-profile.png`) });

    await navigation.getByRole('button', { name: 'Каталог' }).click();
    await expect(page.locator('.catalog-page')).toBeVisible();
    await expectNavigationPainted(page, `catalog-return@400x${height}`);
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
