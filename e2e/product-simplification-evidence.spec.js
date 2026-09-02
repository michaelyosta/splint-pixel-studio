import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const evidenceDir = resolve(process.cwd(), 'docs', 'evidence', 'product-simplification-2026-09-01');
const previewDataUrl = `data:image/png;base64,${readFileSync(resolve(process.cwd(), 'e2e', 'fixtures', 'test-image.png')).toString('base64')}`;
const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

async function settleVisual(page) {
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
}

async function createAndComplete(page, suffix) {
  const cells = new Array(64).fill(0);
  const response = await page.request.post('/api/colorings/create', {
    data: {
      title: `Completion ${suffix}`,
      description: 'Product simplification visual evidence',
      width: 8,
      height: 8,
      palette: ['#0B1522', '#2BD9FE'],
      cells,
      tileSize: 32,
      previewDataUrl,
    },
  });
  expect(response.ok()).toBe(true);
  const created = await response.json();
  const saved = await page.request.post(`/api/colorings/${created.id}/progress/actions`, {
    data: {
      changes: cells.map((_, index) => ({ index, color: 0 })),
      revision: 0,
      clientBatchId: `simplification-evidence-${suffix}`,
    },
  });
  expect(saved.ok()).toBe(true);

  const showcase = await page.request.post('/api/colorings/create', {
    data: {
      title: `Showcase ${suffix}`,
      description: 'Product simplification profile evidence',
      width: 32,
      height: 32,
      palette: ['#0B1522', '#2BD9FE'],
      storageMode: 'tiled',
      tileSize: 32,
      tiles: [{ x: 0, y: 0, width: 32, height: 32, cells: new Array(32 * 32).fill(0) }],
      previewDataUrl,
    },
  });
  expect(showcase.ok()).toBe(true);
  return created.id;
}

test.describe('Product simplification visual evidence', () => {
  test.skip(process.env.PRODUCT_SIMPLIFICATION_EVIDENCE !== '1', 'run explicitly to refresh visual evidence');

  for (const viewport of viewports) {
    test(`capture catalog, create, profiles, and completion at ${viewport.width}px`, async ({ page }) => {
      mkdirSync(evidenceDir, { recursive: true });
      await page.context().setExtraHTTPHeaders({ 'X-User-Id': `e2e_simplification_visual_${viewport.width}` });
      await page.addInitScript(() => localStorage.setItem('splint_onboarding_version', '2'));
      await page.setViewportSize(viewport);
      const coloringId = await createAndComplete(page, String(viewport.width));

      await page.goto('/');
      await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 15000 });
      await settleVisual(page);
      await page.screenshot({ path: resolve(evidenceDir, `catalog-${viewport.width}.png`), fullPage: true });

      await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Создать' }).click();
      await expect(page.locator('.create-hub-page')).toBeVisible();
      await page.screenshot({ path: resolve(evidenceDir, `create-${viewport.width}.png`), fullPage: true });

      await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Профиль' }).click();
      await expect(page.locator('[data-profile-showcase="true"]')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.profile-created-section')).toContainText(`Showcase ${viewport.width}`);
      await page.screenshot({ path: resolve(evidenceDir, `profile-owner-${viewport.width}.png`), fullPage: true });

      await page.goto('/?profile=user_lenaart');
      await expect(page.locator('[data-profile-showcase="true"]')).toContainText('КОЛЛЕКЦИЯ АВТОРА', { timeout: 15000 });
      await settleVisual(page);
      await page.screenshot({ path: resolve(evidenceDir, `profile-public-${viewport.width}.png`), fullPage: true });

      await page.goto(`/?coloring=${encodeURIComponent(coloringId)}`);
      await expect(page.locator('.completion-overlay')).toBeVisible({ timeout: 20000 });
      await settleVisual(page);
      await page.screenshot({ path: resolve(evidenceDir, `completion-${viewport.width}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});
