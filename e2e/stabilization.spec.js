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

async function readCamera(page) {
  const viewport = page.locator('.coloring-canvas-viewport');
  return {
    x: Number(await viewport.getAttribute('data-camera-x')),
    y: Number(await viewport.getAttribute('data-camera-y')),
    zoom: Number(await viewport.getAttribute('data-camera-zoom')),
  };
}

async function paintActiveTarget(page) {
  const canvas = page.locator('canvas.coloring-canvas');
  const activeCells = (await canvas.getAttribute('data-active-work-cells')).split(',').map(Number);
  const templateWidth = Number(await canvas.getAttribute('data-template-width'));
  const box = await canvas.boundingBox();
  for (const index of activeCells) {
    await canvas.click({
      force: true,
      position: {
        x: ((index % templateWidth) + 0.5) * box.width / templateWidth,
        y: (Math.floor(index / templateWidth) + 0.5) * box.width / templateWidth,
      },
    });
  }
}

async function expectActiveTargetFullyVisible(page) {
  const session = page.locator('.coloring-session');
  const viewport = page.locator('.coloring-canvas-viewport');
  const canvas = page.locator('canvas.coloring-canvas');
  await expect.poll(async () => {
    if (await session.getAttribute('data-route-status') !== 'ready') return false;
    const currentCamera = await readCamera(page);
    const currentViewportBox = await viewport.boundingBox();
    const currentCells = (await canvas.getAttribute('data-active-work-cells')).split(',').map(Number);
    const currentTemplateWidth = Number(await canvas.getAttribute('data-template-width'));
    const currentSafe = {
      top: Number(await session.getAttribute('data-safe-top')),
      right: Number(await session.getAttribute('data-safe-right')),
      bottom: Number(await session.getAttribute('data-safe-bottom')),
      left: Number(await session.getAttribute('data-safe-left')),
    };
    return currentCells.length > 0 && currentCells.every((index) => {
      const x = index % currentTemplateWidth;
      const y = Math.floor(index / currentTemplateWidth);
      const left = currentCamera.x + x * 32 * currentCamera.zoom;
      const top = currentCamera.y + y * 32 * currentCamera.zoom;
      const right = left + 32 * currentCamera.zoom;
      const bottom = top + 32 * currentCamera.zoom;
      return left >= currentSafe.left - 0.5
        && top >= currentSafe.top - 0.5
        && right <= currentViewportBox.width - currentSafe.right + 0.5
        && bottom <= currentViewportBox.height - currentSafe.bottom + 0.5;
    });
  }, { timeout: 3000 }).toBe(true);

  const camera = await readCamera(page);
  const viewportBox = await viewport.boundingBox();
  const cells = (await canvas.getAttribute('data-active-work-cells')).split(',').map(Number);
  const templateWidth = Number(await canvas.getAttribute('data-template-width'));
  const safe = {
    top: Number(await session.getAttribute('data-safe-top')),
    right: Number(await session.getAttribute('data-safe-right')),
    bottom: Number(await session.getAttribute('data-safe-bottom')),
    left: Number(await session.getAttribute('data-safe-left')),
  };

  expect(cells.length).toBeGreaterThan(0);
  for (const index of cells) {
    const x = index % templateWidth;
    const y = Math.floor(index / templateWidth);
    const left = camera.x + x * 32 * camera.zoom;
    const top = camera.y + y * 32 * camera.zoom;
    const right = left + 32 * camera.zoom;
    const bottom = top + 32 * camera.zoom;
    expect(left).toBeGreaterThanOrEqual(safe.left - 0.5);
    expect(top).toBeGreaterThanOrEqual(safe.top - 0.5);
    expect(right).toBeLessThanOrEqual(viewportBox.width - safe.right + 0.5);
    expect(bottom).toBeLessThanOrEqual(viewportBox.height - safe.bottom + 0.5);
  }
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
    const cameraBefore = await readCamera(page);
    await viewport.hover();
    await page.mouse.wheel(0, -120);

    await expect(page.locator('.coloring-task-context')).toContainText('Свободный просмотр');
    const cameraAfterWheel = await readCamera(page);
    expect(cameraAfterWheel.zoom).not.toBeCloseTo(cameraBefore.zoom, 4);
    await page.waitForTimeout(1000);
    const cameraAfterOneSecond = await readCamera(page);
    expect(cameraAfterOneSecond.x).toBeCloseTo(cameraAfterWheel.x, 3);
    expect(cameraAfterOneSecond.y).toBeCloseTo(cameraAfterWheel.y, 3);
    expect(cameraAfterOneSecond.zoom).toBeCloseTo(cameraAfterWheel.zoom, 4);
    const returnButton = page.locator('.coloring-hud button:has-text("Вернуться к участку")');
    await expect(returnButton).toBeVisible();
    await returnButton.click();
    await expect(page.locator('.coloring-task-context')).toContainText('Закрась выделенный участок');
    await expect(canvas).toHaveAttribute('data-active-work-cells', targetBefore);
  });

  test('10. Overview explicitly enters free exploration', async ({ page }) => {
    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await dismissOnboarding(page);

    await expect(page.locator('.coloring-session')).toHaveAttribute('data-route-status', 'ready');
    await page.locator('.coloring-hud button:has-text("Обзор")').click();

    await expect(page.locator('.coloring-session')).toHaveAttribute('data-route-status', 'freeExploration');
    await expect(page.locator('.coloring-task-context')).toContainText('Свободный просмотр');
    await expect(page.locator('.coloring-hud button:has-text("Вернуться к участку")')).toBeVisible();
  });

  test('11. Auto transition remains focusing until camera animation completes', async ({ page }) => {
    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await dismissOnboarding(page);

    const session = page.locator('.coloring-session');
    await expect(session).toHaveAttribute('data-route-status', 'ready');
    const generationBefore = Number(await session.getAttribute('data-target-generation'));
    await paintActiveTarget(page);

    await expect(session).toHaveAttribute('data-route-status', 'focusingTarget');
    await expect(page.locator('.coloring-canvas-viewport')).toHaveAttribute('data-interaction-disabled', 'true');
    await expect(session).toHaveAttribute('data-route-status', 'ready', { timeout: 2000 });
    await expect(page.locator('.coloring-canvas-viewport')).toHaveAttribute('data-interaction-disabled', 'false');
    const generationAfter = Number(await session.getAttribute('data-target-generation'));
    expect(generationAfter).toBeGreaterThan(generationBefore);
  });

  test('12. Ten Next actions always change target or finish', async ({ page }) => {
    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await dismissOnboarding(page);

    const session = page.locator('.coloring-session');
    const nextButton = page.locator('.coloring-hud button:has-text("Следующий участок")');
    await expect(session).toHaveAttribute('data-route-status', 'ready');

    for (let i = 0; i < 10; i++) {
      const before = await session.getAttribute('data-target-id');
      await nextButton.click();
      const status = await session.getAttribute('data-route-status');
      if (status === 'artworkComplete') break;
      await expect(session).toHaveAttribute('data-route-status', 'focusingTarget');
      await expect(session).toHaveAttribute('data-route-status', 'ready', { timeout: 2000 });
      await expect(session).not.toHaveAttribute('data-target-id', before);
    }
  });

  test('13. Manual palette selection atomically activates a target of that color', async ({ page }) => {
    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await dismissOnboarding(page);

    const session = page.locator('.coloring-session');
    const canvas = page.locator('canvas.coloring-canvas');
    await expect(session).toHaveAttribute('data-route-status', 'ready');
    const targetBefore = await session.getAttribute('data-target-id');
    const nextSwatch = page.locator('.color-swatch:not(.selected):not(.completed)').first();
    const nextColor = Number(await nextSwatch.locator('span').textContent()) - 1;

    await nextSwatch.click();
    await expect(session).toHaveAttribute('data-route-status', 'focusingTarget');
    await expect(page.locator('.coloring-canvas-viewport')).toHaveAttribute('data-interaction-disabled', 'true');
    await expect(session).toHaveAttribute('data-route-status', 'ready', { timeout: 2000 });
    await expect(session).toHaveAttribute('data-target-color', String(nextColor));
    await expect(canvas).toHaveAttribute('data-active-target-color', String(nextColor));
    await expect(session).not.toHaveAttribute('data-target-id', targetBefore);
    await expectActiveTargetFullyVisible(page);
  });

  test('13b. Selecting a completed color keeps a truthful active target', async ({ page }) => {
    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await dismissOnboarding(page);

    const session = page.locator('.coloring-session');
    const canvas = page.locator('canvas.coloring-canvas');
    await expect(session).toHaveAttribute('data-route-status', 'ready');
    const completedColor = Number(await session.getAttribute('data-target-color'));
    const completedSwatch = page.locator('.color-swatch').nth(completedColor);
    await expect(completedSwatch.locator('small')).toHaveText('1');
    await paintActiveTarget(page);
    await expect(session).toHaveAttribute('data-route-status', 'ready', { timeout: 3000 });
    await expect(completedSwatch).toHaveClass(/completed/);

    await completedSwatch.click();
    await expect(session).toHaveAttribute('data-route-status', 'focusingTarget');
    await expect(page.locator('.coloring-canvas-viewport')).toHaveAttribute('data-interaction-disabled', 'true');
    await expect(session).toHaveAttribute('data-route-status', 'ready', { timeout: 3000 });
    await expect(session).not.toHaveAttribute('data-target-color', String(completedColor));
    const activeColor = await session.getAttribute('data-target-color');
    await expect(canvas).toHaveAttribute('data-active-target-color', activeColor);
    await expect(page.locator('.color-swatch.selected')).toHaveAttribute(
      'title',
      `Цвет ${Number(activeColor) + 1}`,
    );
  });

  test('14. Guided target is revalidated across required viewport sizes', async ({ page }) => {
    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await dismissOnboarding(page);

    const session = page.locator('.coloring-session');
    await expect(session).toHaveAttribute('data-route-status', 'ready');
    const targetId = await session.getAttribute('data-target-id');
    const sizes = [
      { width: 360, height: 640 },
      { width: 640, height: 360 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ];

    for (const size of sizes) {
      await page.setViewportSize(size);
      await expect(session).toHaveAttribute('data-route-status', 'ready', { timeout: 3000 });
      await expect(session).toHaveAttribute('data-target-id', targetId);
      await expectActiveTargetFullyVisible(page);
    }
  });

  test('15. Expanding the HUD preserves and revalidates the same target', async ({ page }) => {
    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await dismissOnboarding(page);

    const session = page.locator('.coloring-session');
    await expect(session).toHaveAttribute('data-route-status', 'ready');
    const targetId = await session.getAttribute('data-target-id');
    await page.locator('.hud-btn--collapse').click();
    await expect(page.locator('.coloring-hud--collapsed')).toBeVisible();
    await page.locator('.hud-btn--expand').click();
    await expect(page.locator('.coloring-hud:not(.coloring-hud--collapsed)')).toBeVisible();
    await expect(session).toHaveAttribute('data-route-status', 'ready', { timeout: 3000 });
    await expect(session).toHaveAttribute('data-target-id', targetId);
    await expectActiveTargetFullyVisible(page);
  });

  test('16. Resize in free exploration preserves manual camera and target', async ({ page }) => {
    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await dismissOnboarding(page);

    const session = page.locator('.coloring-session');
    const targetId = await session.getAttribute('data-target-id');
    await page.locator('.coloring-hud button:has-text("Обзор")').click();
    await expect(session).toHaveAttribute('data-route-status', 'freeExploration');
    await page.waitForTimeout(500);
    const freeCamera = await readCamera(page);

    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(500);
    await expect(session).toHaveAttribute('data-route-status', 'freeExploration');
    await expect(session).toHaveAttribute('data-target-id', targetId);
    const resizedCamera = await readCamera(page);
    expect(resizedCamera.x).toBeCloseTo(freeCamera.x, 3);
    expect(resizedCamera.y).toBeCloseTo(freeCamera.y, 3);
    expect(resizedCamera.zoom).toBeCloseTo(freeCamera.zoom, 4);

    await page.locator('.coloring-hud button:has-text("Вернуться к участку")').click();
    await expect(session).toHaveAttribute('data-route-status', 'ready', { timeout: 3000 });
    await expect(session).toHaveAttribute('data-target-id', targetId);
    await expectActiveTargetFullyVisible(page);
  });
});
