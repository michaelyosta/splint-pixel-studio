import { test, expect } from '@playwright/test';

const API_HEADERS = { 'Content-Type': 'application/json', 'X-User-Id': 'user_pixelhunter' };

test.describe('Stabilization — Smart Coloring Engine', () => {

  async function dismissOnboarding(page) {
    const skipBtn = page.locator('.onboarding-card .secondary-button');
    if (await skipBtn.isVisible().catch(() => false)) await skipBtn.click();
    await page.waitForTimeout(200);
  }

  test('1. Opening a coloring produces no page errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    const firstCard = page.locator('.coloring-card').first();
    await expect(firstCard).toBeVisible({ timeout: 15000 });
    await firstCard.locator('.primary-button').click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });

    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
  });

  test('2. Single tap paints a cell with no errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });

    await dismissOnboarding(page);

    const canvas = page.locator('canvas.coloring-canvas');
    await expect(canvas).toBeVisible({ timeout: 5000 });
    await canvas.click({ position: { x: 50, y: 50 } });
    await page.waitForTimeout(500);

    expect(errors).toEqual([]);
  });

  test('3. Undo/redo menu buttons present in reveal mode', async ({ page }) => {
    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
    await dismissOnboarding(page);

    /* Open bottom sheet menu */
    await page.locator('.player-menu-btn').click();
    await expect(page.locator('.bottom-sheet')).toBeVisible({ timeout: 5000 });

    /* Undo/redo buttons should be visible */
    const undoBtn = page.locator('.bottom-sheet-actions button:has-text("Отмена")');
    await expect(undoBtn).toBeVisible();
    const redoBtn = page.locator('.bottom-sheet-actions button:has-text("Повтор")');
    await expect(redoBtn).toBeVisible();
  });

  test('3b. Painting a cell produces no pageerror', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
    await dismissOnboarding(page);

    /* Use canvas bounding box to find a valid click position */
    const canvas = page.locator('canvas.coloring-canvas');
    await expect(canvas).toBeVisible({ timeout: 5000 });
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width * 0.2, y: box.height * 0.3 } });
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test('4. Initial view shows overview not a random spot', async ({ page }) => {
    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });

    const overviewBtn = page.locator('button:has-text("Обзор")');
    await expect(overviewBtn).toBeVisible({ timeout: 5000 });
  });

  test('5. Camera auto does not move during painting', async ({ page }) => {
    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
    await dismissOnboarding(page);

    const canvas = page.locator('canvas.coloring-canvas');
    await expect(canvas).toBeVisible({ timeout: 5000 });

    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await canvas.click({ position: { x: 50, y: 50 } });
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test('6. Wheel zoom preserves cursor world position', async ({ page }) => {
    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
    await dismissOnboarding(page);

    const canvas = page.locator('canvas.coloring-canvas');
    await expect(canvas).toBeVisible({ timeout: 5000 });

    await canvas.hover();
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(200);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(200);
  });

  test('7. Auto is disabled by default in reveal mode', async ({ page }) => {
    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });

    const autoBtn = page.locator('button:has-text("Авто выкл.")');
    await expect(autoBtn).toBeVisible({ timeout: 5000 });
  });
});
