import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(__dirname, 'fixtures', 'test-image.png');

test('capture 16-zone player at 390px', async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': 'zone_visual_1' });
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
  await page.goto('/');
  await page.getByText('Создать').first().click();
  await page.getByRole('button', { name: 'Из изображения' }).click();
  await page.locator('.file-field input[type="file"]').setInputFiles([fixture]);
  // Use the named preset click path so the selected option and its preview
  // fingerprint stay in the same state as normal user interaction.
  await page.getByRole('button', { name: 'Сетка 1200 на 1200' }).click();
  await expect(page.locator('.creator-previews')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.creator-preview-option.selected')).toHaveAttribute('data-status', 'ready', { timeout: 120000 });
  const saveButton = page.locator('button', { hasText: 'Сохранить и начать' });
  await expect(saveButton).toBeEnabled({ timeout: 120000 });
  await saveButton.click();
  await expect(page.locator('.creator-success-page')).toBeVisible({ timeout: 20000 });
  await page.locator('.creator-success-page button:has-text("Начать раскрашивать")').click();
  await expect(page.locator('.progressive-coloring-session')).toBeVisible({ timeout: 15000 });
  await page.locator('.progressive-grid-area canvas').first().focus();
  await page.keyboard.press('2');
  await expect
    .poll(async () => Number(await page.locator('.progressive-grid-area').getAttribute('data-camera-zoom')), { timeout: 5000 })
    .toBeGreaterThanOrEqual(0.9);
  await page.waitForTimeout(1200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  console.log('ZONE_COUNT', await page.locator('.progressive-grid-minimap').getAttribute('data-zone-count'));
  console.log('ACTIVE_ZONE', await page.locator('.progressive-grid-minimap').getAttribute('data-active-zone'));
  console.log('ZOOM', await page.locator('.progressive-grid-area').getAttribute('data-camera-zoom'));
  await page.screenshot({ path: 'docs/evidence/zones-16-390.png', fullPage: false });
});
