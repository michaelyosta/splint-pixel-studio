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
  const primaryNavigation = page.getByRole('navigation', { name: 'Основная навигация' });
  await primaryNavigation.getByRole('button', { name: 'Каталог', exact: true }).click();
  await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 15000 });
}

async function openFirstCatalogColoring(page) {
  await gotoCatalog(page);
  const firstCard = page.locator('.catalog-art-card').first();
  await expect(firstCard).toBeVisible({ timeout: 15000 });
  await firstCard.locator('.catalog-art-open').click();
  await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
}

async function gotoFeed(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Сообщество' }).first().click();
  await expect(page.locator('.feed-page')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.feed-post').first()).toBeVisible({ timeout: 15000 });
}

const API_HEADERS = { 'Content-Type': 'application/json' };

function normalizeHexColor(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(value || '');
  if (!match) throw new Error(`Expected six-digit palette color, got ${value}`);
  return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16));
}

async function assertPreviewPixelsMatchSubmittedTiles(page, payload) {
  const samplePixels = [[47, 53], [131, 97], [255, 255], [379, 301], [463, 447]];
  const decoded = await page.evaluate(async ({ dataUrl, samples }) => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return {
      width: canvas.width,
      height: canvas.height,
      pixels: samples.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data.slice(0, 3)]),
    };
  }, { dataUrl: payload.previewDataUrl, samples: samplePixels });
  expect(decoded.width).toBe(512);
  expect(decoded.height).toBe(512);

  const tileSize = payload.tileSize;
  samplePixels.forEach(([previewX, previewY], index) => {
    const sourceX = Math.min(payload.width - 1, Math.floor(((previewX + 0.5) * payload.width) / decoded.width));
    const sourceY = Math.min(payload.height - 1, Math.floor(((previewY + 0.5) * payload.height) / decoded.height));
    const tile = payload.tiles.find((candidate) => candidate.x === Math.floor(sourceX / tileSize)
      && candidate.y === Math.floor(sourceY / tileSize));
    expect(tile).toBeTruthy();
    const localX = sourceX % tileSize;
    const localY = sourceY % tileSize;
    const colorIndex = tile.cells[(localY * tile.width) + localX];
    const expectedRgb = normalizeHexColor(payload.palette[colorIndex]);
    expect(decoded.pixels[index]).toEqual(expectedRgb);
  });
}

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
  await expect(page.locator('.creator-preview-option[data-resolution="512"]')).toHaveAttribute('data-status', 'ready', { timeout: 30000 });
  await expect(page.locator('.creator-preview-option.selected')).toHaveAttribute('data-resolution', '512');
  await expect(page.locator('.creator-previews')).toBeVisible();
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

  test('Create hub keeps free creator paths without commercial promises', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Создать').first().click();
    const hub = page.locator('.create-hub-page');
    await expect(hub).toBeVisible({ timeout: 10000 });
    await expect(hub).not.toContainText(/Продать набор|витрин|Stars|Premium/i);
    await expect(hub.getByRole('button', { name: /Из изображения/ })).toBeEnabled();
    await expect(hub.getByRole('button', { name: /Нарисовать самому/ })).toBeEnabled();
    await expect(hub.getByRole('button', { name: /Собрать бесплатную коллекцию/ })).toBeEnabled();

    for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
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
    await expect(page.locator('.creator-resolution-options')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.creator-preview-option')).toHaveCount(4);
    await expect(page.locator('.creator-crop-section')).toBeVisible();
    await expect(page.locator('.creator-colors-section')).toBeVisible();
    await expect(page.locator('.file-field')).toContainText('test-image.png');
  });

  test('3a. Photo creator defaults to the detail-preserving 512×512/16-colour mode', async ({ page }) => {
    await page.goto('/');
    await openImageCreator(page);
    await page.locator('.file-field input[type="file"]').setInputFiles([fixturePath('test-image.png')]);
    await expect(page.locator('.creator-preview-option.selected')).toHaveAttribute('data-resolution', '512');
    await expect(page.locator('.creator-colors-badge')).toHaveText('16');
    await expect(page.locator('.creator-resolution-note')).toContainText('по умолчанию выбран баланс 512');
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
    await page.getByRole('button', { name: 'Сетка 512 на 512' }).click();
    await expect(page.locator('.creator-preview-option.selected')).toHaveAttribute('data-resolution', '512');
    await page.getByRole('button', { name: 'Сетка 1200 на 1200' }).click();
    await expect(page.locator('.creator-preview-option.selected')).toHaveAttribute('data-resolution', '1200');
    await expect(page.locator('.creator-resolution-note')).toContainText('не автоматический');
    const colorSlider = page.locator('.creator-colors-section input[type="range"]');
    await colorSlider.fill('12');
    await expect(page.locator('.creator-colors-badge')).toHaveText('12');
  });

  test('6. Compute shows previews and quality indicator', async ({ page }) => {
    await page.goto('/');
    await openImageCreator(page);
    await page.locator('.file-field input[type="file"]').setInputFiles([fixturePath('test-image.png')]);
    await page.getByText('Пересчитать выбранный вариант').click();
    await expect(page.locator('.creator-previews')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.creator-preview-item')).toHaveCount(3);
    await expect(page.locator('.creator-quality')).toBeVisible({ timeout: 15000 });
  });

  test('6a. Resolution race cannot replace the latest selected preview', async ({ page }) => {
    await page.goto('/');
    await openImageCreator(page);
    await page.locator('.file-field input[type="file"]').setInputFiles([fixturePath('test-image.png')]);
    await page.getByRole('button', { name: 'Сетка 1200 на 1200' }).click();
    await page.getByRole('button', { name: 'Сетка 192 на 192' }).click();
    const selected = page.locator('.creator-preview-option.selected');
    await expect(selected).toHaveAttribute('data-resolution', '192');
    await expect(selected).toHaveAttribute('data-status', 'ready', { timeout: 60000 });
    const fingerprint = await selected.getAttribute('data-result-fingerprint');
    await expect(page.locator('.creator-selected-evidence')).toHaveAttribute('data-selected-resolution', '192');
    await expect(page.locator('.creator-selected-evidence')).toHaveAttribute('data-result-fingerprint', fingerprint);
    await expect(page.locator('.creator-preview-option[data-resolution="1200"]')).not.toHaveAttribute('data-status', 'ready');
  });

  test('6b. Selected 192×192 exact preview computes, saves, and opens', async ({ page }) => {
    await page.goto('/');
    await openImageCreator(page);
    await page.locator('.file-field input[type="file"]').setInputFiles([fixturePath('test-image.png')]);
    await page.getByRole('button', { name: 'Сетка 192 на 192' }).click();
    await expect(page.locator('.creator-preview-option.selected')).toHaveAttribute('data-resolution', '192');
    await expect(page.locator('.creator-preview-option.selected')).toHaveAttribute('data-status', 'ready', { timeout: 60000 });
    await expect(page.locator('.creator-previews')).toBeVisible({ timeout: 20000 });
    const selectedFingerprint = await page.locator('.creator-preview-option.selected').getAttribute('data-result-fingerprint');
    let createPayload = null;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/colorings/create')) createPayload = request.postDataJSON();
    });
    const id = await saveColoring(page);
    expect(createPayload.resultFingerprint).toBe(selectedFingerprint);
    expect(createPayload).not.toHaveProperty('previewFingerprint');
    if (createPayload.previewPixelFingerprint) expect(typeof createPayload.previewPixelFingerprint).toBe('string');
    await assertPreviewPixelsMatchSubmittedTiles(page, createPayload);
    const response = await page.request.get(`/api/colorings/${id}`, { headers: API_HEADERS });
    const template = await response.json();
    expect(template.width).toBe(192);
    expect(template.height).toBe(192);
    const savedFirstTile = await (await page.request.get(`/api/colorings/${id}/tiles/0/0`, { headers: API_HEADERS })).json();
    expect(savedFirstTile.cells).toEqual(createPayload.tiles[0].cells);
    await expect(page.locator('.progressive-coloring-session')).toBeVisible({ timeout: 15000 });
    const coloringCanvas = page.locator('.progressive-grid-area canvas').first();
    await expect(coloringCanvas).toBeVisible();
    expect(await coloringCanvas.evaluate((element) => element.width)).toBeLessThan(2_000);
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
    await page.locator('.grid-detail-range').fill('3');
    const selectedCard = page.locator('.creator-preview-option.selected');
    await expect(selectedCard).toHaveAttribute('data-resolution', '1200');
    await expect(selectedCard).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });
    await expect(page.locator('.creator-previews')).toBeVisible({ timeout: 45000 });
    const selectedFingerprint = await selectedCard.getAttribute('data-result-fingerprint');
    let createPayload = null;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/colorings/create')) {
        createPayload = request.postDataJSON();
      }
    });
    const id = await saveColoring(page);
    expect(createPayload.width).toBe(1200);
    expect(createPayload.resultFingerprint).toBe(selectedFingerprint);
    expect(createPayload).not.toHaveProperty('previewFingerprint');
    if (createPayload.previewPixelFingerprint) expect(typeof createPayload.previewPixelFingerprint).toBe('string');
    await assertPreviewPixelsMatchSubmittedTiles(page, createPayload);
    const response = await page.request.get(`/api/colorings/${id}`, { headers: API_HEADERS });
    expect(response.ok()).toBe(true);
    const template = await response.json();
    expect(template.storage_mode).toBe('tiled');
    expect(template.tile_size).toBe(32);
    expect(template.cells).toEqual([]);
    expect(template.preview_url).toMatch(/^data:image\/png;base64,/);
    const firstTile = await (await page.request.get(`/api/colorings/${id}/tiles/0/0`, { headers: API_HEADERS })).json();
    expect(firstTile.cells).toEqual(createPayload.tiles[0].cells);
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
    // Completion behavior is independent of the recovery creator's tiled-only
    // detail choices. Keep this pre-existing regression bounded with a small
    // legacy template instead of posting 36,864 completion actions.
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const createResponse = await page.request.post('/api/colorings/create', {
      headers: API_HEADERS,
      data: {
        title: 'Completion flow fixture',
        width: 8,
        height: 8,
        palette: ['#0b1522', '#2bd9fe'],
        cells: Array.from({ length: 64 }, (_, index) => index % 2),
        previewDataUrl: png,
      },
    });
    expect(createResponse.status()).toBe(201);
    const id = (await createResponse.json()).id;
    await page.goto('/');
    await page.getByRole('button', { name: 'Профиль', exact: true }).click();
    await page.getByRole('button', { name: 'Смотреть все' }).click();
    await page.locator('.gallery-row').filter({ hasText: 'Completion flow fixture' }).click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });

    const tplResp = await page.request.get(`/api/colorings/${id}`, { headers: API_HEADERS });
    expect(tplResp.ok()).toBe(true);
    const tpl = await tplResp.json();

    // Complete through bounded server-authoritative actions.
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
    await page.locator('.gallery-row').filter({ hasText: 'Completion flow fixture' }).click();
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
    const createResponsePromise = page.waitForResponse((response) => (
      response.url().includes('/api/colorings/create')
      && response.request().method() === 'POST'
    ));
    await page.locator('button:has-text("Сохранить и начать")').click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(201);
    const created = await createResponse.json();
    expect(created.id).toMatch(/^color_/);
    expect(created.title).toBeTruthy();
    await expect(page.locator('.creator-success-page')).toBeVisible({ timeout: 15000 });
    await page.locator('.creator-success-page button:has-text("Начать раскрашивать")').click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
    await page.locator('.onboarding-card .secondary-button').click().catch(() => {});
    await page.locator('.back-button').click();
    await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Профиль' }).first().click();
    await page.getByRole('button', { name: 'Смотреть все' }).click();
    await expect(page.locator('.gallery-list')).toBeVisible({ timeout: 10000 });
    const createdRow = page.locator('.gallery-row').filter({ hasText: created.title });
    await expect(createdRow).toHaveCount(1);
    const deleteBtn = createdRow.locator('.delete-button');
    await expect(deleteBtn).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    const deleteResponsePromise = page.waitForResponse((response) => (
      response.url().includes(`/api/colorings/${created.id}`)
      && response.request().method() === 'DELETE'
    ));
    await deleteBtn.click();
    const deleteResponse = await deleteResponsePromise;
    expect(deleteResponse.status()).toBe(200);
    await expect(deleteResponse.json()).resolves.toEqual({ success: true });
    await expect(createdRow).toHaveCount(0);

    const mineResponse = await page.request.get('/api/colorings/mine');
    expect(mineResponse.ok()).toBe(true);
    const mine = await mineResponse.json();
    expect(mine.some((item) => item.id === created.id)).toBe(false);
    const deletedResponse = await page.request.get(`/api/colorings/${created.id}`);
    expect(deletedResponse.status()).toBe(404);
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
    await openFirstCatalogColoring(page);
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
