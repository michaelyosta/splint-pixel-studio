import { test, expect } from '@playwright/test';

async function assertNavigationVisible(page) {
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' });
  const buttons = navigation.getByRole('button');
  await expect(navigation).toBeVisible();
  await expect(buttons).toHaveCount(3);

  const visibility = await navigation.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const buttonChecks = [...element.querySelectorAll('button')].map((button) => {
      const buttonRect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(buttonRect.left + buttonRect.width / 2, buttonRect.top + buttonRect.height / 2);
      return buttonRect.width > 0 && buttonRect.height > 0 && (hit === button || button.contains(hit));
    });
    return {
      width: rect.width,
      height: rect.height,
      display: style.display,
      visibility: style.visibility,
      opacity: Number(style.opacity),
      withinViewport: rect.top >= 0 && rect.bottom <= window.innerHeight,
      buttonsReceiveHits: buttonChecks.every(Boolean),
    };
  });

  expect(visibility.width).toBeGreaterThan(0);
  expect(visibility.height).toBeGreaterThan(0);
  expect(visibility.display).not.toBe('none');
  expect(visibility.visibility).toBe('visible');
  expect(visibility.opacity).toBeGreaterThan(0);
  expect(visibility.withinViewport).toBe(true);
  expect(visibility.buttonsReceiveHits).toBe(true);
}

async function captureScreen(page, testInfo, height, destination) {
  await assertNavigationVisible(page);
  await page.screenshot({ path: testInfo.outputPath(`navigation-${height}-${destination}.png`) });
}

test('three-tab navigation remains painted and reachable through viewport growth', async ({ page }, testInfo) => {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': `e2e_nav_growth_${testInfo.testId}` });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('splint_onboarding_version', '2');
      localStorage.setItem('splint:first-run-guide:v1', 'dismissed');
    } catch { /* restricted storage is valid */ }
  });

  for (const height of [640, 844]) {
    await page.setViewportSize({ width: 400, height });
    await page.goto('/');
    await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-catalog-hero-cta="true"]')).toBeVisible({ timeout: 15000 });
    await captureScreen(page, testInfo, height, 'catalog');

    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Создать' }).click();
    await expect(page.locator('.create-hub-page')).toBeVisible();
    await captureScreen(page, testInfo, height, 'create');

    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Профиль' }).click();
    await expect(page.locator('[data-profile-showcase]')).toBeVisible({ timeout: 15000 });
    await captureScreen(page, testInfo, height, 'profile');

    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Каталог' }).click();
    await expect(page.locator('.catalog-page')).toBeVisible();
    await assertNavigationVisible(page);
  }
});
