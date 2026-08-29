import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourceImage = resolve(__dirname, '..', 'public', 'assets', 'catalog', 'alpine-train.png');
const evidenceDirectory = resolve(__dirname, '..', 'docs', 'evidence', 'creator-preview-recovery');

async function openCreator(page) {
  await page.goto('/');
  await page.getByText('Создать').first().click();
  await page.getByRole('button', { name: 'Из изображения' }).click();
  await page.locator('.file-field input[type="file"]').setInputFiles(sourceImage);
  // The current creator contract computes only the recommended 512x512
  // preview after upload. Other resolutions are explicit, user-selected
  // comparisons so an expensive preview is never built invisibly in the
  // background. Select 192 before asserting its evidence is ready.
  await page.getByRole('button', { name: 'Сетка 192 на 192' }).click();
  await expect(page.locator('.creator-preview-option[data-resolution="192"]')).toHaveAttribute('data-status', 'ready', { timeout: 60000 });
  await expect(page.locator('.creator-number-preview img')).toBeVisible();
}

for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
  test(`creator preview is readable without overflow at ${viewport.width}px`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'one deterministic Chromium capture per exact mobile viewport');
    await page.context().setExtraHTTPHeaders({ 'X-User-Id': `e2e_creator_visual_${viewport.width}` });
    await page.setViewportSize(viewport);
    await openCreator(page);

    await expect(page.locator('.creator-preview-option')).toHaveCount(4);
    await expect(page.locator('.creator-preview-report')).toBeVisible();
    await expect(page.locator('.creator-preview-stats')).toContainText('читаемость номеров');
    const dimensions = await page.locator('.creator-number-preview img').evaluate((image) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
    }));
    expect(dimensions).toEqual({ width: 480, height: 480 });
    expect(await page.locator('.creator-card').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

    mkdirSync(evidenceDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(evidenceDirectory, `creator-preview-${viewport.width}.png`),
      fullPage: true,
    });
    await page.locator('.creator-selected-evidence').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(evidenceDirectory, `creator-preview-${viewport.width}-detail.png`),
    });
  });
}
