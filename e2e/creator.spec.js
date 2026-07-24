import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
function fixturePath(name) {
  return resolve(__dirname, 'fixtures', name);
}

const API_HEADERS = { 'Content-Type': 'application/json', 'X-User-Id': 'user_pixelhunter' };

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

// Helper: upload a file on the Creator page and wait for auto-compute
async function uploadAndCompute(page) {
  await page.goto('/');
  await page.getByText('Создать').first().click();
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

  test('1. App shell and navigation render', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.app-header')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('nav.app-tab-bar')).toBeVisible();
    await page.getByText('Создать').first().click();
    await expect(page.locator('.creator-page')).toBeVisible();
  });

  test('2. Creator controls visible on page', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Создать').first().click();
    await expect(page.locator('.file-field')).toBeVisible();
    await expect(page.locator('.file-field')).toContainText('PNG');
  });

  test('3. File upload shows grid, crop, and color controls', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Создать').first().click();
    await page.locator('.file-field input[type="file"]').setInputFiles([fixturePath('test-image.png')]);
    await expect(page.locator('.creator-grid-options')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.creator-crop-section')).toBeVisible();
    await expect(page.locator('.creator-colors-section')).toBeVisible();
    await expect(page.locator('.file-field')).toContainText('test-image.png');
  });

  test('4. Crop mode shows zoom and offset sliders', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Создать').first().click();
    await page.locator('.file-field input[type="file"]').setInputFiles([fixturePath('test-image.png')]);
    await page.getByText('Кадрировать').click();
    const sliders = page.locator('.creator-crop-section input[type="range"]');
    await expect(sliders).toHaveCount(3);
    await expect(page.locator('.creator-crop-section label').first()).toContainText('Масштаб');
  });

  test('5. Grid and color controls update state', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Создать').first().click();
    await page.locator('.file-field input[type="file"]').setInputFiles([fixturePath('test-image.png')]);
    await page.getByText('32×32').click();
    await expect(page.locator('.creator-grid-options .selected')).toContainText('32×32');
    const colorSlider = page.locator('.creator-colors-section input[type="range"]');
    await colorSlider.fill('12');
    await expect(page.locator('.creator-colors-badge')).toHaveText('12');
  });

  test('6. Compute shows previews and quality indicator', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Создать').first().click();
    await page.locator('.file-field input[type="file"]').setInputFiles([fixturePath('test-image.png')]);
    await page.getByText('Обновить превью').click();
    await expect(page.locator('.creator-previews')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.creator-preview-item')).toHaveCount(3);
    await expect(page.locator('.creator-quality')).toBeVisible({ timeout: 15000 });
  });

  test('7. Reset crop restores defaults', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Создать').first().click();
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

    // PUT completed progress via API
    const filled = tpl.cells.map((c) => c);
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const progResp = await page.request.put(`/api/colorings/${id}/progress`, {
      headers: API_HEADERS,
      data: { filled, revision: 0, resultDataUrl: png },
    });
    expect(progResp.ok()).toBe(true);
    const progData = await progResp.json();
    expect(progData.percent).toBe(100);
    expect(progData.artwork_id).toBeTruthy();

    // Navigate to gallery and back to the coloring to trigger progress re-fetch
    await page.locator('.onboarding-card .secondary-button').click().catch(() => {});
    await page.locator('.back-button').click();
    await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 5000 });
    await page.getByText('Мои').first().click();
    await expect(page.locator('.gallery-list')).toBeVisible({ timeout: 10000 });
    await page.locator('.gallery-row').first().click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });

    // Completion overlay should appear with all buttons
    await expect(page.locator('.completion-overlay')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.completion-dialog')).toBeVisible();
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
    await page.goto('/');
    await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 15000 });
    const firstCard = page.locator('.coloring-card').first();
    await expect(firstCard).toBeVisible({ timeout: 15000 });
    await firstCard.locator('.primary-button').click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('canvas.coloring-canvas')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.player-topbar')).toBeVisible();
    await expect(page.locator('.palette')).toBeVisible();
  });

  test('11. Delete a user-created coloring from gallery', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Создать').first().click();
    await page.locator('.file-field input[type="file"]').setInputFiles(['e2e/fixtures/test-image.png']);
    await expect(page.locator('.creator-previews')).toBeVisible({ timeout: 15000 });
    await page.locator('button:has-text("Сохранить и начать")').click();
    await expect(page.locator('.creator-success-page')).toBeVisible({ timeout: 15000 });
    await page.locator('.creator-success-page button:has-text("Начать раскрашивать")').click();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
    await page.locator('.onboarding-card .secondary-button').click().catch(() => {});
    await page.locator('.back-button').click();
    await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 5000 });
    await page.getByText('Мои').first().click();
    await expect(page.locator('.gallery-list')).toBeVisible({ timeout: 10000 });
    const deleteBtn = page.locator('.delete-button').first();
    await expect(deleteBtn).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await deleteBtn.click();
  });

  test('12. Feed: like, comment, follow interactions', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Лента').first().click();
    await expect(page.locator('.feed-list')).toBeVisible({ timeout: 15000 });
    const post = page.locator('.feed-post').first();
    await expect(post).toBeVisible({ timeout: 10000 });

    // Like a post
    const likeBtn = post.locator('.post-actions button').first();
    const initialText = await likeBtn.textContent();
    await likeBtn.click();
    await page.waitForTimeout(600);
    const afterText = await likeBtn.textContent();
    expect(afterText).not.toBe(initialText);

    // Open comments and submit
    const commentBtn = post.locator('button:has-text("Комментарии")');
    if (await commentBtn.isVisible().catch(() => false)) {
      await commentBtn.click();
      await expect(page.locator('.comments-panel')).toBeVisible({ timeout: 5000 });
      const input = page.locator('.comments-panel input');
      await expect(input).toBeVisible();
      await input.fill('Тестовый комментарий');
      await input.press('Enter');
      await page.waitForTimeout(600);
      await expect(page.locator('.comment-row')).toBeVisible({ timeout: 5000 });
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
    const views = ['Каталог', 'Альбомы', 'Мои', 'Лента'];
    let widths = [];
    for (const view of views) {
      await page.goto('/');
      await page.getByText(view).first().click();
      await page.waitForTimeout(300);
      const box = await page.locator('.telegram-frame').boundingBox();
      widths.push({ view, width: Math.round(box.width) });
    }
    const uniqueWidths = new Set(widths.map((w) => w.width));
    expect(uniqueWidths.size).toBe(1);
  });

  test('14. Player guided mode keeps the canvas clear of persistent metrics', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.coloring-card').first()).toBeVisible({ timeout: 15000 });
    await page.locator('.coloring-card').first().locator('.primary-button').click();
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
    await expect(page.locator('.coloring-card').first()).toBeVisible({ timeout: 15000 });
    await page.locator('.coloring-card').first().locator('.primary-button').click();
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
    await page.goto('/');
    await expect(page.locator('.coloring-card')).toHaveCount(6, { timeout: 15000 });
    const positions = await page.locator('.coloring-card .primary-button').evaluateAll((buttons) =>
      buttons.map((button) => Math.round(button.getBoundingClientRect().bottom)),
    );
    for (let index = 0; index < positions.length; index += 2) {
      expect(positions[index + 1]).toBe(positions[index]);
    }
  });

  test('17. Player dock switches between reveal and classic coloring', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.coloring-card').first()).toBeVisible({ timeout: 15000 });
    await page.locator('.coloring-card').first().locator('.primary-button').click();
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
    const previous = await (await page.request.get(`/api/colorings/${openedTemplate.id}/progress`, { headers: API_HEADERS })).json();
    const reset = await page.request.put(`/api/colorings/${openedTemplate.id}/progress`, {
      headers: API_HEADERS,
      data: { filled: Array(openedTemplate.total_cells).fill(-1), revision: previous.revision },
    });
    expect(reset.ok()).toBe(true);
    await page.goto('/');
    await page.locator('.coloring-card').first().locator('.primary-button').click();
    await page.locator('.onboarding-card .secondary-button').click().catch(() => {});
    await page.locator('.player-menu-btn').click();
    await page.locator('.bottom-sheet-actions button:has-text("Режим раскрытия")').click();
    const savePromise = page.waitForResponse((response) =>
      response.request().method() === 'PUT' && response.url().includes(`/colorings/${openedTemplate.id}/progress`),
    );
    await clickActiveWorkCell(page);
    const saved = await (await savePromise).json();
    expect(saved.completed_cells).toBeGreaterThan(0);
  });

  test('19. Completing a zone celebrates the revealed fragment without XP copy', async ({ page }) => {
    await page.goto('/');
    const openButton = page.locator('.coloring-card').first().locator('.primary-button');
    const templateResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'GET' && /\/colorings\/[^/]+$/.test(new URL(response.url()).pathname),
    );
    await openButton.click();
    const openedTemplate = await (await templateResponsePromise).json();
    const progress = await (await page.request.get(`/api/colorings/${openedTemplate.id}/progress`, { headers: API_HEADERS })).json();
    const zones = await (await page.request.get(`/api/colorings/${openedTemplate.id}/zones`, { headers: API_HEADERS })).json();
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
    const filled = [...openedTemplate.cells];
    filled[finalIndex] = -1;
    fillerIndices.forEach((index) => { filled[index] = -1; });
    const prepared = await page.request.put(`/api/colorings/${openedTemplate.id}/progress`, {
      headers: API_HEADERS,
      data: { filled, revision: progress.revision },
    });
    expect(prepared.ok()).toBe(true);

    await page.goto('/');
    await page.locator('.coloring-card').filter({ hasText: openedTemplate.title }).locator('.primary-button').click();
    await page.locator('.onboarding-card .secondary-button').click().catch(() => {});
    await clickActiveWorkCell(page);
    await expect(page.locator('.milestone.zone')).toContainText(`Фрагмент «${zone.title}» раскрыт`);
    await expect(page.locator('.milestone.zone')).not.toContainText('XP');
  });
});
