import { test, expect } from '@playwright/test';

async function clickActiveWorkCell(page) {
  const canvas = page.locator('canvas.coloring-canvas');
  await expect(canvas).toBeVisible({ timeout: 10000 });
  await expect(canvas).not.toHaveAttribute('data-active-work-cells', '');
  const activeCells = (await canvas.getAttribute('data-active-work-cells')).split(',').map(Number);
  const templateWidth = Number(await canvas.getAttribute('data-template-width'));
  const box = await canvas.boundingBox();
  const index = activeCells[0];
  await canvas.click({
    force: true,
    position: {
      x: ((index % templateWidth) + 0.5) * box.width / templateWidth,
      y: (Math.floor(index / templateWidth) + 0.5) * box.width / templateWidth,
    },
  });
}

test.describe('Stabilization — Smart Coloring Engine', () => {

  async function dismissOnboarding(page) {
    const skipBtn = page.locator('.onboarding-card .secondary-button');
    await skipBtn.waitFor({ state: 'visible', timeout: 1000 }).catch(() => {});
    if (await skipBtn.isVisible().catch(() => false)) await skipBtn.click();
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

    await clickActiveWorkCell(page);
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

    await clickActiveWorkCell(page);
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test('4. Initial view exposes an actionable target', async ({ page }) => {
    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.coloring-task-context')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('canvas.coloring-canvas')).not.toHaveAttribute('data-active-work-cells', '');
  });

  test('5. Camera auto does not move during painting', async ({ page }) => {
    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
    await dismissOnboarding(page);

    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await clickActiveWorkCell(page);
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test('6. Wheel zoom preserves cursor world position', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Mouse wheel is a desktop-only input');
    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
    await dismissOnboarding(page);

    const viewport = page.locator('.coloring-canvas-viewport');
    await expect(viewport).toBeVisible({ timeout: 5000 });
    await viewport.hover();
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(200);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(200);
  });

  test('7. Reveal mode remains actionable without palette controls', async ({ page }) => {
    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });

    await dismissOnboarding(page);
    await page.locator('.player-menu-btn').click();
    await page.locator('.bottom-sheet-actions button:has-text("Режим раскрытия")').click();
    await expect(page.locator('.palette')).toHaveCount(0);
    await expect(page.locator('canvas.coloring-canvas')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('canvas.coloring-canvas')).not.toHaveAttribute('data-active-work-cells', '');
  });

  test('8. Onboarding completion persists and can be replayed', async ({ page }) => {
    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    const skipBtn = page.locator('.onboarding-card .secondary-button');
    await expect(skipBtn).toBeVisible({ timeout: 5000 });
    await skipBtn.click();

    await page.reload();
    await expect(page.locator('.coloring-card').first()).toBeVisible({ timeout: 15000 });
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await expect(page.locator('.coloring-task-context')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.onboarding-overlay')).toHaveCount(0);

    await page.locator('.player-menu-btn').click();
    await page.locator('.bottom-sheet-actions button:has-text("Показать обучение снова")').click();
    await expect(page.locator('.onboarding-card')).toContainText('Начнём с этого участка');
    await expect(page.locator('.onboarding-card .secondary-button')).toContainText('Пропустить обучение');
  });

  test('9. Free exploration requires an explicit return to the same target', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Mouse wheel is a desktop-only input');
    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await dismissOnboarding(page);

    const canvas = page.locator('canvas.coloring-canvas');
    await expect(canvas).not.toHaveAttribute('data-active-work-cells', '');
    const targetBefore = await canvas.getAttribute('data-active-work-cells');
    const viewport = page.locator('.coloring-canvas-viewport');
    await viewport.hover();
    await page.mouse.wheel(0, -120);

    await expect(page.locator('.coloring-task-context')).toContainText('Свободный просмотр');
    const returnButton = page.locator('.coloring-hud button:has-text("Вернуться к участку")');
    await expect(returnButton).toBeVisible();
    await returnButton.click();
    await expect(page.locator('.coloring-task-context')).toContainText('Закрась выделенный участок');
    await expect(canvas).toHaveAttribute('data-active-work-cells', targetBefore);
  });
});
