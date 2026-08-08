import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
function fixturePath(name) {
  return resolve(__dirname, 'fixtures', name);
}

async function openImageCreator(page) {
  await page.getByText('Создать').first().click();
  await page.getByRole('button', { name: 'Из изображения' }).click();
  await expect(page.locator('.creator-page')).toBeVisible({ timeout: 10000 });
}

async function gotoCatalog(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Каталог' }).first().click();
  await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 15000 });
}

async function gotoFeed(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Сообщество' }).first().click();
  await expect(page.locator('.feed-page')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.feed-post').first()).toBeVisible({ timeout: 15000 });
}

const API_HEADERS = { 'Content-Type': 'application/json' };

async function applyProgressChanges(page, id, changes, revision, resultDataUrl = null) {
  let saved;
  let nextRevision = revision;
  for (let offset = 0; offset < changes.length; offset += 64) {
    const response = await page.request.post(`/api/colorings/${id}/progress/actions`, {
      headers: API_HEADERS,
      data: {
        changes: changes.slice(offset, offset + 64),
        revision: nextRevision,
        resultDataUrl: offset + 64 >= changes.length ? resultDataUrl : null,
      },
    });
    expect(response.ok()).toBe(true);
    saved = await response.json();
    nextRevision = saved.revision;
  }
  return saved;
}

async function clickActiveWorkCell(page) {
  const canvas = page.locator('canvas.coloring-canvas');
  await expect(canvas).toBeVisible({ timeout: 10000 });
  await expect(canvas).not.toHaveAttribute('data-active-work-cells', '');
  const activeCells = (await canvas.getAttribute('data-active-work-cells')).split(',').map(Number);
  const templateWidth = Number(await canvas.getAttribute('data-template-width'));
  const viewport = page.locator('.coloring-canvas-viewport');
  const camera = {
    x: Number(await viewport.getAttribute('data-camera-x')),
    y: Number(await viewport.getAttribute('data-camera-y')),
    zoom: Number(await viewport.getAttribute('data-camera-zoom')),
  };
  const index = activeCells[0];
  await canvas.click({
    force: true,
    position: {
      x: camera.x + ((index % templateWidth) + 0.5) * 32 * camera.zoom,
      y: camera.y + (Math.floor(index / templateWidth) + 0.5) * 32 * camera.zoom,
    },
  });
}

// Helper: upload a file on the Creator page and wait for auto-compute
async function uploadAndCompute(page) {
  await page.goto('/');
  await openImageCreator(page);
  await page.locator('.file-field input[type="file"]').setInputFiles([fixturePath('test-image.png')]);
  await expect(page.locator('.creator-previews')).toBeVisible({ timeout: 15000 });
}

// Helper: save the coloring and return its id
async function saveColoring(page) {
  const saveBtn = page.locator('button', { hasText: 'Сохранить и начать' });
  await expect(saveBtn).toBeVisible({ timeout: 10000 });
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/colorings/create')),
    saveBtn.click(),
  ]);
  expect(resp.status()).toBe(201);
  const created = await resp.json();
  expect(created.id).toMatch(/^color_/);
  await expect(page.locator('.creator-success-page')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.creator-success-page')).toContainText('Раскраска готова');
  await page.locator('.creator-success-page button:has-text("Начать раскрашивать")').click();
  await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
  return created.id;
}

test.describe('Creator 2.0 — full E2E', () => {

  test.beforeEach(async ({ page }, testInfo) => {
    await page.context().setExtraHTTPHeaders({ 'X-User-Id': `e2e_${testInfo.testId}` });
  });

  test('1. App shell and navigation render', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.app-header')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('nav.app-tab-bar')).toBeVisible();
    await openImageCreator(page);
  });

  test('2. Creator controls visible on page', async ({ page }) => {
    await page.goto('/');
    await openImageCreator(page);
    await expect(page.locator('.file-field')).toBeVisible();
    await expect(page.locator('.file-field')).toContainText('PNG');
  });

  test('3. File upload shows grid, crop, and color controls', async ({ page }) => {
    await page.goto('/');
    await openImageCreator(page);
    await page.locator('.file-field input[type="file"]').setInputFiles([fixturePath('test-image.png')]);
    await expect(page.locator('.creator-grid-options')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.creator-crop-section')).toBeVisible();
    await expect(page.locator('.creator-colors-section')).toBeVisible();
    await expect(page.locator('.file-field')).toContainText('test-image.png');
  });

  test('4. Crop mode shows zoom and offset sliders', async ({ page }) => {
    await page.goto('/');
    await openImageCreator(page);
    await page.locator('.file-field input[type="file"]').setInputFiles([fixturePath('test-image.png')]);
    await page.getByText('Кадрировать').click();
    const sliders = page.locator('.creator-crop-section input[type="range"]');
    await expect(sliders).toHaveCount(3);
    await expect(page.locator('.creator-crop-section label').first()).toContainText('Масштаб');
  });

  test('5. Grid and color controls update state', async ({ page }) => {
    await page.goto('/');
    await openImageCreator(page);
    await page.locator('.file-field input[type="file"]').setInputFiles([fixturePath('test-image.png')]);
    await page.getByRole('button', { name: 'Сетка 32×32' }).click();
    await expect(page.locator('.creator-grid-options .selected')).toContainText('32');
    await page.getByRole('button', { name: 'Сетка 160×160' }).click();
    await expect(page.locator('.creator-grid-options .selected')).toContainText('160');
    await expect(page.locator('.creator-grid-hint')).toContainText('Максимум текущего renderer');
    const colorSlider = page.locator('.creator-colors-section input[type="range"]');
    await colorSlider.fill('12');
    await expect(page.locator('.creator-colors-badge')).toHaveText('12');
  });

  test('6. Compute shows previews and quality indicator', async ({ page }) => {
    await page.goto('/');
    await openImageCreator(page);
    await page.locator('.file-field input[type="file"]').setInputFiles([fixturePath('test-image.png')]);
    await page.getByText('Обновить превью').click();
    await expect(page.locator('.creator-previews')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.creator-preview-item')).toHaveCount(3);
    await expect(page.locator('.creator-quality')).toBeVisible({ timeout: 15000 });
  });

  test('6b. Maximum 160×160 grid computes, saves, and opens', async ({ page }) => {
    await page.goto('/');
    await openImageCreator(page);
    await page.locator('.file-field input[type="file"]').setInputFiles([fixturePath('test-image.png')]);
    await page.getByRole('button', { name: 'Сетка 160×160' }).click();
    // The grid selection state updates asynchronously; wait for it to stick
    // before recomputing, otherwise the previews/save can use the previous
    // grid (flaky width mismatch on slow emulators).
    await expect(page.locator('.creator-grid-options .selected')).toContainText('160');
    await page.getByText('Обновить превью').click();
    // The save button renders as soon as ANY previous result exists, so it
    // can be clicked while the 160×160 recompute is still running — posting
    // the stale 32×32 result. Wait for the recompute to actually finish: the
    // compute button (first .create-button) re-enables only after it settles.
    await expect(page.locator('button.create-button').first()).toBeEnabled({ timeout: 60000 });
    await expect(page.locator('.creator-previews')).toBeVisible({ timeout: 20000 });
    const id = await saveColoring(page);
    const response = await page.request.get(`/api/colorings/${id}`, { headers: API_HEADERS });
    const template = await response.json();
    expect(template.width).toBe(160);
    expect(template.height).toBe(160);
    const coloringCanvas = page.locator('canvas.coloring-canvas');
    await expect(coloringCanvas).toHaveAttribute('data-template-width', '160');
    expect(await coloringCanvas.evaluate((element) => element.width)).toBeLessThan(2_000);
    const onboardingSkip = page.locator('.onboarding-card .secondary-button');
    await page.locator('.onboarding-card').waitFor({ state: 'visible', timeout: 3_000 }).then(() => onboardingSkip.click({ force: true })).catch(() => {});
    await clickActiveWorkCell(page);
  });

  test('6c. 1200x1200 creator path uploads tiled storage and opens bounded player', async ({ page }, testInfo) => {
    // The 1200×1200 image pipeline (client-side compute of 1.44M cells) is
    // slow under software rendering on mobile emulation; the heavy step is
    // the creator save flow, not the tiled player.
    test.setTimeout(120_000);
    // Playwright WebKit never finishes the detail-18 auto-compute (1.44M
    // cells) under software rendering, so the create button never enables.
    // The bounded tiled player itself is covered on chromium and Mobile
    // Pixel. Same skip rationale as the accessibility-1200 webkit case.
    test.skip(testInfo.project.name === 'Mobile iPhone', 'detail-18 creator compute is unbounded under Playwright WebKit emulation');
    await page.goto('/');
    await openImageCreator(page);
    await page.locator('.file-field input[type="file"]').setInputFiles([fixturePath('test-image.png')]);
    await page.locator('.grid-detail-range').fill('18');
    // The create button stays disabled until the client-side image pipeline
    // finishes; on mobile WebKit emulation that can take well over a minute.
    await expect(page.locator('button.create-button').first()).toBeEnabled({ timeout: 120_000 });
    await page.locator('button.create-button').first().click();
    await expect(page.locator('.creator-previews')).toBeVisible({ timeout: 45000 });
    const id = await saveColoring(page);
    const response = await page.request.get(`/api/colorings/${id}`, { headers: API_HEADERS });
    expect(response.ok()).toBe(true);
    const template = await response.json();
    expect(template.storage_mode).toBe('tiled');
    expect(template.tile_size).toBe(32);
    expect(template.cells).toEqual([]);
    expect(template.preview_url).toMatch(/^data:image\/png;base64,/);
    await expect(page.locator('.progressive-coloring-session')).toBeVisible({ timeout: 15000 });

    // A visible 1200×1200 tile must be actionable, not just rendered.
    // Jump to zone 1, read the cell under the camera centre, and select its
    // colour so the tap is never rejected as a wrong-color tap.
    const onboardingSkip = page.locator('.onboarding-card .secondary-button');
    await page.locator('.onboarding-card').waitFor({ state: 'visible', timeout: 3_000 }).then(() => onboardingSkip.click({ force: true })).catch(() => {});
    const gridArea = page.locator('.progressive-grid-area');
    const cameraBeforeZone = await gridArea.getAttribute('data-camera-x');
    const mainCanvas = page.locator('.progressive-grid-area canvas').first();
    await mainCanvas.focus();
    await page.keyboard.press('1');
    await expect(gridArea).not.toHaveAttribute('data-camera-x', cameraBeforeZone);
    const canvas = mainCanvas;
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    const camera = {
      x: Number(await gridArea.getAttribute('data-camera-x')),
      y: Number(await gridArea.getAttribute('data-camera-y')),
      zoom: Number(await gridArea.getAttribute('data-camera-zoom')),
    };
    const gridAreaBox = await gridArea.boundingBox();
    const centerWorldX = (box.x + box.width / 2 - gridAreaBox.x - camera.x) / camera.zoom / 32;
    const centerWorldY = (box.y + box.height / 2 - gridAreaBox.y - camera.y) / camera.zoom / 32;
    const centerCell = {
      x: Math.floor(centerWorldX),
      y: Math.floor(centerWorldY),
      tileX: Math.floor(Math.floor(centerWorldX) / 32),
      tileY: Math.floor(Math.floor(centerWorldY) / 32),
    };
    const centerTileResponse = await page.request.get(`/api/colorings/${id}/tiles/${centerCell.tileX}/${centerCell.tileY}`, { headers: API_HEADERS });
    expect(centerTileResponse.ok()).toBe(true);
    const centerTile = await centerTileResponse.json();
    const targetColor = Number(centerTile.cells[(centerCell.y % 32) * 32 + (centerCell.x % 32)]);
    await page.locator('.progressive-grid-dock .color-swatch').nth(targetColor).click();
    // Selecting a colour makes the smart engine re-plan for that colour, so
    // wait until the applied plan actually carries the requested colour and
    // the camera settled. The suggested anchor is then guaranteed to be an
    // unfilled cell of the selected colour with its tile resident — the first
    // tap paints.
    const progressAction = page.waitForResponse((response) => response.url().includes('/progress/actions') && response.request().method() === 'POST');
    await expect.poll(async () => {
      const state = await page.locator('.progressive-coloring-session').getAttribute('data-smart-state');
      const color = await page.locator('.progressive-coloring-session').getAttribute('data-smart-color');
      return state === 'ready' && color === String(targetColor);
    }, { timeout: 15000 }).toBe(true);
    const settledCamera = {
      x: Number(await gridArea.getAttribute('data-camera-x')),
      y: Number(await gridArea.getAttribute('data-camera-y')),
      zoom: Number(await gridArea.getAttribute('data-camera-zoom')),
    };
    const anchorX = Number(await page.locator('.progressive-coloring-session').getAttribute('data-smart-target-x'));
    const anchorY = Number(await page.locator('.progressive-coloring-session').getAttribute('data-smart-target-y'));
    const settledBox = await gridArea.boundingBox();
    // A short settle window after the engine confirms the requested colour
    // keeps the click deterministic (camera fully committed to the target).
    await page.waitForTimeout(400);
    await page.mouse.click(
      settledBox.x + settledCamera.x + (anchorX + 0.5) * 32 * settledCamera.zoom,
      settledBox.y + settledCamera.y + (anchorY + 0.5) * 32 * settledCamera.zoom,
    );
    const saved = await progressAction;
    expect(saved.status()).toBe(200);
    expect((await saved.json()).completed_cells).toBeGreaterThan(0);
  });

  test('7. Reset crop restores defaults', async ({ page }) => {
    await page.goto('/');
    await openImageCreator(page);
    await page.locator('.file-field input[type="file"]').setInputFiles([fixturePath('test-image.png')]);
    await page.getByText('Кадрировать').click();
    const scaleSlider = page.locator('.creator-crop-section input[type="range"]').first();
    await scaleSlider.fill('2');
    await expect(scaleSlider).toHaveValue('2');
    await page.getByText('Сбросить кадрирование').click();
    await expect(scaleSlider).toHaveValue('1');
  });

  test('8. Save flow: saves, confirms, and opens play view', async ({ page }) => {
    await uploadAndCompute(page);
    await saveColoring(page);
  });

  test('9. Completion flow: 100% → overlay → Escape → buttons', async ({ page }) => {
    // Save a coloring
    await uploadAndCompute(page);
    const id = await saveColoring(page);

    // Get template cells
    const tplResp = await page.request.get(`/api/colorings/${id}`, { headers: API_HEADERS });
    expect(tplResp.ok()).toBe(true);
    const tpl = await tplResp.json();

    // Complete through bounded server-authoritative actions.
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const progData = await applyProgressChanges(page, id, tpl.cells.map((color, index) => ({ index, color })), 0, png);
    expect(progData.percent).toBe(100);
    expect(progData.artwork_id).toBeTruthy();
    const persistedProgressResponse = await page.request.get(`/api/colorings/${id}/progress`, { headers: API_HEADERS });
    expect(persistedProgressResponse.ok()).toBe(true);
    const persistedProgress = await persistedProgressResponse.json();
    expect(persistedProgress.artwork_id).toBe(progData.artwork_id);
    expect(persistedProgress.render_status).toBe('ready');

    // Navigate to gallery and back to the coloring to trigger progress re-fetch
    await page.locator('.onboarding-card .secondary-button').click().catch(() => {});
    await page.locator('.back-button').click();
    await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Профиль', exact: true }).click();
    await page.getByRole('button', { name: 'Смотреть все' }).click();
    await expect(page.locator('.gallery-list')).toBeVisible({ timeout: 10000 });
    await page.locator('.gallery-row').first().click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });

    // Completion overlay should appear with all buttons
    await expect(page.locator('.completion-overlay')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.completion-dialog')).toBeVisible();
    await expect(page.locator('.completion-links button').first()).toBeEnabled();
    await expect(page.locator('.completion-rewards')).toContainText('XP');
    await expect(page.locator('#completion-title')).toContainText('Картина раскрыта');
    await expect(page.locator('.completion-dialog button:has-text("Поделиться")')).toBeVisible();
    await expect(page.locator('.completion-dialog button:has-text("Сохранить результат")')).toBeVisible();
    await expect(page.locator('.completion-dialog button:has-text("Опубликовать")')).toBeVisible();
    await expect(page.locator('.completion-dialog button:has-text("К каталогу")')).toBeVisible();

    // Test Escape closes overlay
    await page.keyboard.press('Escape');
    await expect(page.locator('.completion-overlay')).not.toBeVisible();
  });

  test('10. Catalog → open coloring → player renders guided canvas', async ({ page }) => {
    await gotoCatalog(page);
    const firstCard = page.locator('.catalog-art-card').first();
    await expect(firstCard).toBeVisible({ timeout: 15000 });
    await firstCard.locator('.catalog-art-open').click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('canvas.coloring-canvas')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.player-topbar')).toBeVisible();
    await expect(page.locator('.palette')).toBeVisible();
  });

  test('11. Delete a user-created coloring from gallery', async ({ page }) => {
    await page.goto('/');
    await openImageCreator(page);
    await page.locator('.file-field input[type="file"]').setInputFiles(['e2e/fixtures/test-image.png']);
    await expect(page.locator('.creator-previews')).toBeVisible({ timeout: 15000 });
    await page.locator('button:has-text("Сохранить и начать")').click();
    await expect(page.locator('.creator-success-page')).toBeVisible({ timeout: 15000 });
    await page.locator('.creator-success-page button:has-text("Начать раскрашивать")').click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
    await page.locator('.onboarding-card .secondary-button').click().catch(() => {});
    await page.locator('.back-button').click();
    await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Профиль' }).first().click();
    await page.getByRole('button', { name: 'Смотреть все' }).click();
    await expect(page.locator('.gallery-list')).toBeVisible({ timeout: 10000 });
    const deleteBtn = page.locator('.delete-button').first();
    await expect(deleteBtn).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await deleteBtn.click();
  });

  test('12. Feed: like, comment, follow interactions', async ({ page }) => {
    await gotoFeed(page);
    const post = page.locator('.feed-post').first();
    await expect(post).toBeVisible({ timeout: 10000 });

    // Like a post
    const likeBtn = post.locator('.post-actions button').first();
    const initialText = await likeBtn.textContent();
    const likeResponse = page.waitForResponse(
      (response) => response.url().includes('/like') && response.request().method() === 'POST',
      { timeout: 10000 },
    );
    await likeBtn.click();
    await likeResponse;
    await expect.poll(() => likeBtn.textContent(), { timeout: 5000 }).not.toBe(initialText);
    const afterText = await likeBtn.textContent();
    expect(afterText).not.toBe(initialText);

    // Open comments and submit
    const commentBtn = post.getByRole('button', { name: 'Комментарии' });
    if (await commentBtn.isVisible().catch(() => false)) {
      await commentBtn.click();
      await expect(page.locator('.comments-panel')).toBeVisible({ timeout: 5000 });
      const input = page.locator('.comments-panel input');
      await expect(input).toBeVisible();
      await input.fill('Тестовый комментарий');
      await input.press('Enter');
      await page.waitForTimeout(600);
      await expect(page.locator('.comment-row').first()).toBeVisible({ timeout: 5000 });
    }

    // Follow the post author (if not self)
    const followBtn = post.locator('.follow-button');
    if (await followBtn.isVisible().catch(() => false)) {
      const followText = await followBtn.textContent();
      await followBtn.click();
      await page.waitForTimeout(600);
      const newFollowText = await followBtn.textContent();
      expect(newFollowText).not.toBe(followText);
    }
  });

  test('13. Stable shell width across views', async ({ page }) => {
    const views = ['Каталог', 'Сообщество', 'Профиль'];
    let widths = [];
    for (const view of views) {
      await page.goto('/');
      await page.getByRole('button', { name: view }).first().click();
      await page.waitForTimeout(300);
      const box = await page.locator('.telegram-frame').boundingBox();
      widths.push({ view, width: Math.round(box.width) });
    }
    const uniqueWidths = new Set(widths.map((w) => w.width));
    expect(uniqueWidths.size).toBe(1);
  });

  test('14. Player guided mode keeps the canvas clear of persistent metrics', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.home-featured-card, .home-continue-card, .home-art-card').first()).toBeVisible({ timeout: 15000 });
    await page.locator('.home-featured-card, .home-continue-card, .home-art-card').first().click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('canvas.coloring-canvas')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.player-topbar')).toBeVisible();
    await expect(page.locator('.palette')).toBeVisible();
    await expect(page.locator('.player-topbar-progress')).toHaveCount(0);
    await expect(page.locator('.progress-bar')).toHaveCount(0);
    await expect(page.locator('.zone-track')).toHaveCount(0);
    await expect(page.locator('.game-hud')).toHaveCount(0);
    await expect(page.locator('.paint-tools')).toHaveCount(0);
    await expect(page.locator('.game-actions')).toHaveCount(0);
  });

  test('15. Player menu opens and shows secondary actions', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.home-featured-card, .home-continue-card, .home-art-card').first()).toBeVisible({ timeout: 15000 });
    await page.locator('.home-featured-card, .home-continue-card, .home-art-card').first().click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
    await page.locator('.onboarding-card .secondary-button').click().catch(() => {});
    await page.locator('.player-menu-btn').click();
    await expect(page.locator('.bottom-sheet')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.bottom-sheet-actions')).toBeVisible();
    await expect(page.locator('.bottom-sheet-info')).toContainText('XP:');
    await expect(page.locator('.bottom-sheet-actions button:has-text("Заполнять область")')).toBeVisible();
    await expect(page.locator('.bottom-sheet-close')).toBeVisible();
    await page.locator('.bottom-sheet-close').click();
    await expect(page.locator('.bottom-sheet')).not.toBeVisible();
  });

  test('16. Catalog card actions stay aligned despite different copy lengths', async ({ page }) => {
    await gotoCatalog(page);
    await expect(page.locator('.catalog-art-card').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.catalog-art-card').nth(1)).toBeVisible();
    const positions = await page.locator('.catalog-art-card .catalog-art-open').evaluateAll((buttons) =>
      buttons.map((button) => Math.round(button.getBoundingClientRect().bottom)),
    );
    for (let index = 0; index + 1 < positions.length; index += 2) {
      expect(Math.abs(positions[index + 1] - positions[index])).toBeLessThanOrEqual(1);
    }
  });

  test('17. Player dock switches between reveal and classic coloring', async ({ page }) => {
    await gotoCatalog(page);
    await expect(page.locator('.catalog-art-card').first()).toBeVisible({ timeout: 15000 });
    await page.locator('.catalog-art-card').first().locator('.catalog-art-open').click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
    await page.locator('.onboarding-card .secondary-button').click().catch(() => {});
    await expect(page.locator('.palette')).toBeVisible();
    await page.locator('.player-menu-btn').click();
    await page.locator('.bottom-sheet-actions button:has-text("Режим раскрытия")').click();
    await expect(page.locator('.palette')).toHaveCount(0);
    await page.locator('.player-menu-btn').click();
    await page.locator('.bottom-sheet-actions button:has-text("По номерам")').click();
    await expect(page.locator('.palette')).toBeVisible();
  });

  test('18. Reveal mode paints without selecting a palette color first', async ({ page }) => {
    const catalog = await (await page.request.get('/api/colorings', { headers: API_HEADERS })).json();
    const openedTemplate = catalog[0];
    await gotoCatalog(page);
    await page.locator('.catalog-art-card').first().locator('.catalog-art-open').click();
    await page.locator('.onboarding-card .secondary-button').click().catch(() => {});
    await page.locator('.player-menu-btn').click();
    await page.locator('.bottom-sheet-actions button:has-text("Режим раскрытия")').click();
    const savePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().includes(`/colorings/${openedTemplate.id}/progress/actions`),
    );
    await clickActiveWorkCell(page);
    const saved = await (await savePromise).json();
    expect(saved.completed_cells).toBeGreaterThan(0);
  });

  test('19. Completing a zone celebrates the revealed fragment without XP copy', async ({ page }) => {
    const catalogResponse = await page.request.get('/api/colorings', { headers: API_HEADERS });
    expect(catalogResponse.ok()).toBe(true);
    const [catalogTemplate] = await catalogResponse.json();
    expect(catalogTemplate?.id).toBeTruthy();

    const templateResponse = await page.request.get(`/api/colorings/${catalogTemplate.id}`, { headers: API_HEADERS });
    expect(templateResponse.ok()).toBe(true);
    const openedTemplate = await templateResponse.json();
    const progress = await (await page.request.get(`/api/colorings/${openedTemplate.id}/progress`, { headers: API_HEADERS })).json();
    const zonesResponse = await page.request.get(`/api/colorings/${openedTemplate.id}/zones`, { headers: API_HEADERS });
    expect(zonesResponse.ok()).toBe(true);
    const zones = await zonesResponse.json();
    const zone = zones.zones.find((item) => item.indices.length > 1);
    const zoneSet = new Set(zone.indices);
    const outsideByColor = new Map();
    openedTemplate.cells.forEach((color, index) => {
      if (zoneSet.has(index)) return;
      if (!outsideByColor.has(color)) outsideByColor.set(color, []);
      outsideByColor.get(color).push(index);
    });
    const finalIndex = zone.indices.find((index) =>
      [...outsideByColor.entries()].some(([color, indices]) =>
        color !== openedTemplate.cells[index] && indices.length >= 6));
    const fillerIndices = [...outsideByColor.entries()]
      .find(([color, indices]) => color !== openedTemplate.cells[finalIndex] && indices.length >= 6)[1]
      .slice(0, 6);
    const omitted = new Set([finalIndex, ...fillerIndices]);
    await applyProgressChanges(page, openedTemplate.id,
      openedTemplate.cells.flatMap((color, index) => omitted.has(index) ? [] : [{ index, color }]),
      progress.revision);

    await gotoCatalog(page);
    await page.locator('.catalog-art-card').filter({ hasText: openedTemplate.title }).locator('.catalog-art-open').first().click();
    await page.locator('.onboarding-card .secondary-button').click().catch(() => {});
    await clickActiveWorkCell(page);
    await expect(page.locator('.milestone.zone')).toContainText(`Фрагмент «${zone.title}» раскрыт`);
    await expect(page.locator('.milestone.zone')).not.toContainText('XP');
  });
});
