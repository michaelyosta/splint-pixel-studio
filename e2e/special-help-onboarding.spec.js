import { test, expect } from '@playwright/test';

function legacyPayload(width = 28) {
  return {
    storageMode: 'legacy',
    width,
    height: width,
    palette: ['#101820', '#ffffff'],
    cells: Array(width * width).fill(0),
  };
}

async function createForCohort(page, { cohort, payload }) {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': 'user_special_help' });
  const fixtureResponse = await page.request.post('/api/__e2e/seed-cohort-template', {
    data: {
      cohort,
      storage: payload.storageMode === 'tiled' ? 'tiled' : 'legacy',
      size: { width: payload.width, height: payload.height },
    },
  });
  expect(fixtureResponse.ok()).toBe(true);
  const fixture = await fixtureResponse.json();
  expect(fixture.cohort).toBe(cohort);
  expect(fixture.storage).toBe(payload.storageMode === 'tiled' ? 'tiled' : 'legacy');
  expect(fixture.size).toEqual({ width: payload.width, height: payload.height });
  const progressResponse = await page.request.get(`/api/colorings/${fixture.id}/progress`);
  expect(progressResponse.ok()).toBe(true);
  const progress = await progressResponse.json();
  return { created: { id: fixture.id }, progress };
}

async function focusLegacyCell(page, index) {
  const canvas = page.locator('.coloring-canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('.coloring-canvas-viewport')).toHaveAttribute('data-interaction-disabled', 'false');
  await canvas.focus();
  await canvas.press('Home');
  const x = index % 28;
  const y = Math.floor(index / 28);
  for (let step = 0; step < x; step += 1) await canvas.press('ArrowRight');
  for (let step = 0; step < y; step += 1) await canvas.press('ArrowDown');
  await expect(canvas).toHaveAttribute('data-keyboard-cell', String(index));
  return canvas;
}

test('legacy picture with specials shows compact special-cell onboarding once and opens the legend', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { created } = await createForCohort(page, {
    cohort: 'treatment',
    title: 'Special help intro',
    payload: legacyPayload(160),
  });

  await page.goto(`/?coloring=${created.id}`);
  const card = page.locator('.onboarding-card');
  await expect(card).toBeVisible({ timeout: 15000 });
  await expect(card).toContainText('Начнём с этого участка');

  for (let step = 0; step < 3; step += 1) {
    await card.locator('.primary-button').click();
  }
  await expect(page.locator('[data-special-help-intro]')).toBeVisible();
  await expect(page.locator('[data-special-help-intro]')).toContainText('следуйте короткой подсказке');
  await expect(page.locator('[data-special-help-intro] li')).toHaveCount(0);

  await card.locator('.primary-button').click();
  await expect(page.locator('.onboarding-overlay')).toHaveCount(0);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('splint_special_help_v1')));
  expect(stored.introSeen).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('splint_onboarding_version'))).toBe('2');
  expect(stored.kinds.length).toBeLessThan(6);

  await page.locator('.player-menu-btn').click();
  await page.locator('.bottom-sheet-actions button:has-text("Особые клетки")').click();
  await expect(page.locator('[data-special-help-open]')).toBeVisible();
  await expect(page.locator('[data-special-help-open] li[data-special-help-kind]')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-special-help-open]')).toHaveCount(0);

  const afterHelp = await page.evaluate(() => JSON.parse(localStorage.getItem('splint_special_help_v1')).kinds);
  expect(afterHelp.length).toBeLessThan(6);
});

test('control picture never shows special intro, hint, or help overlay', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { created, progress } = await createForCohort(page, {
    cohort: 'control',
    title: 'Special help control',
    payload: legacyPayload(28),
  });
  expect(progress.specials_experiment_group).toBe('control');
  expect(progress.specials).toEqual([]);

  await page.goto(`/?coloring=${created.id}`);
  const card = page.locator('.onboarding-card');
  await expect(card).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-special-help-intro]')).toHaveCount(0);

  for (let step = 0; step < 2; step += 1) {
    await card.locator('.primary-button').click();
  }
  await expect(page.locator('[data-special-help-intro]')).toHaveCount(0);
  await card.locator('.primary-button').click();

  await expect(page.locator('.onboarding-overlay')).toHaveCount(0);
  await expect(page.locator('[data-special-help-intro]')).toHaveCount(0);
  await expect(page.locator('[data-special-help-hint]')).toHaveCount(0);
  await expect(page.locator('[data-special-help-open]')).toHaveCount(0);
  await page.locator('.player-menu-btn').click();
  await expect(page.locator('.bottom-sheet-actions button:has-text("Особые клетки")')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('splint_special_help_v1'))).toBeNull();
});

test('special kind shows one pre-paint hint with inline action and survives reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });
  const { created, progress } = await createForCohort(page, {
    cohort: 'treatment',
    title: 'Special help hint',
    payload: legacyPayload(28),
  });
  expect(progress.specials).toHaveLength(1);
  const spark = progress.specials[0];

  await page.goto(`/?coloring=${created.id}`);
  await expect(page.locator('.coloring-session')).toHaveAttribute('data-special-cohort', 'treatment', { timeout: 15000 });
  const hint = page.locator('[data-special-help-hint]');
  await expect(hint).toBeVisible();
  await expect(hint).toHaveAttribute('data-special-help-kind', 'spark');
  await expect(hint).toContainText('выберите участок');
  await hint.locator('button:has-text("Памятка")').click();
  await expect(page.locator('[data-special-help-open]')).toBeVisible();
  await expect(page.locator('[data-special-help-open] li[data-special-help-kind="spark"]')).toBeVisible();
  await page.locator('[data-special-help-open] .primary-button').click();
  await expect(page.locator('[data-special-help-hint]')).toHaveCount(0);

  const canvas = await focusLegacyCell(page, spark.cell_index);
  const claimResponse = page.waitForResponse((response) => response.url().includes(`/colorings/${created.id}/progress/actions`)
    && response.request().method() === 'POST');
  await canvas.press('Enter');
  const claimed = await (await claimResponse).json();
  expect(claimed.special_discovered).toEqual({ special_id: spark.id, kind: 'spark' });
  await expect(page.locator('.legacy-grid-special-offer')).toBeVisible();

  const seen = await page.evaluate(() => JSON.parse(localStorage.getItem('splint_special_help_v1')).kinds);
  expect(seen).toContain('spark');

  await page.reload();
  await expect(page.locator('.coloring-session')).toHaveAttribute('data-special-cohort', 'treatment', { timeout: 15000 });
  await expect(page.locator('[data-special-help-hint]')).toHaveCount(0);
});
