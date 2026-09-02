import { test, expect } from '@playwright/test';
import { waitForColoringSessionReady } from './input-gesture-helpers.js';

async function primeLocalStorage(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('splint_onboarding_version', '2');
    } catch {
      // Storage may be unavailable; onboarding is dismissed below when needed.
    }
  });
}

async function dismissOnboarding(page) {
  const skip = page.locator('.onboarding-card .secondary-button');
  await skip.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await skip.isVisible().catch(() => false)) await skip.click({ force: true });
  await expect(page.locator('.onboarding-overlay')).toHaveCount(0).catch(() => {});
}

async function openPlayer(page, coloringId = null, search = '') {
  const params = new URLSearchParams(String(search).replace(/^\?/, ''));
  if (coloringId) params.set('coloring', coloringId);
  const target = params.toString() ? `/?${params.toString()}` : '/';
  await page.goto(target);
  if (!coloringId) {
    const card = page.locator('.catalog-art-open').first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.click();
  }
  await expect(page.locator('.player-page')).toBeVisible({ timeout: 60000 });
  await dismissOnboarding(page);
}

async function openFirstCatalogPlayer(page, search = '') {
  const query = String(search).replace(/^\?/, '');
  await page.goto(query ? `/?${query}` : '/');
  const card = page.locator('.catalog-art-open').first();
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.click();
  await expect(page.locator('.player-page')).toBeVisible({ timeout: 60000 });
  await dismissOnboarding(page);
}

async function tapActiveWorkCell(page) {
  const canvas = page.locator('canvas.coloring-canvas');
  await expect(canvas).toBeVisible({ timeout: 10000 });
  await expect.poll(async () => (
    (await canvas.getAttribute('data-active-work-cells').catch(() => '')).split(',').filter(Boolean).length > 0
  ), { timeout: 5000 }).toBe(true);
  const activeCells = (await canvas.getAttribute('data-active-work-cells')).split(',').map(Number);
  await tapCell(page, activeCells[0]);
}

async function tapCell(page, index) {
  const canvas = page.locator('canvas.coloring-canvas');
  await expect(canvas).toBeVisible({ timeout: 10000 });
  const templateWidth = Number(await canvas.getAttribute('data-template-width'));
  const viewport = page.locator('.coloring-canvas-viewport');
  const camera = {
    x: Number(await viewport.getAttribute('data-camera-x')),
    y: Number(await viewport.getAttribute('data-camera-y')),
    zoom: Number(await viewport.getAttribute('data-camera-zoom')),
  };
  await canvas.click({
    force: true,
    position: {
      x: camera.x + ((index % templateWidth) + 0.5) * 32 * camera.zoom,
      y: camera.y + (Math.floor(index / templateWidth) + 0.5) * 32 * camera.zoom,
    },
  });
}

async function readStoredSession(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => name.startsWith('splint:session-goals:'));
    if (!key) return null;
    try {
      return { key, data: JSON.parse(localStorage.getItem(key)) };
    } catch {
      return { key, data: null };
    }
  });
}

async function createSmallColoring(page, { leaveWorkAfterFirstGoal = false } = {}) {
  const cells = Array.from({ length: 64 }, () => 0);
  const workCells = leaveWorkAfterFirstGoal
    ? [27, 28, 29, 35, 36, 37, 43, 44]
    : [27, 28, 29];
  workCells.forEach((index) => { cells[index] = 1; });
  const response = await page.request.post('/api/colorings/create', {
    data: {
      title: 'Цель-тест',
      description: 'Deterministic 8x8 session-goal coloring',
      width: 8,
      height: 8,
      palette: ['#0B1522', '#2BD9FE'],
      cells,
      tileSize: 32,
    },
  });
  expect(response.ok()).toBe(true);
  const created = await response.json();
  expect(created.id).toMatch(/^color_/);
  return created.id;
}

test.describe('Session goals', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await page.context().setExtraHTTPHeaders({ 'X-User-Id': `e2e_goals_${testInfo.testId}` });
    await primeLocalStorage(page);
  });

  test('legacy control query cannot restore the removed session-goal surface', async ({ page }) => {
    await openFirstCatalogPlayer(page, 'sessionGoals=control');
    await expect(page.locator('.player-page')).toHaveAttribute('data-session-goals-visible', 'false');
    await expect(page.locator('.session-goal-card')).toHaveCount(0);
    await tapActiveWorkCell(page);
    await expect(page.locator('.save-status')).toBeVisible();
    expect(await readStoredSession(page)).toBeNull();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('offline and reopen do not create hidden progression state', async ({ page }) => {
    await openFirstCatalogPlayer(page, 'sessionGoals=control');
    await tapActiveWorkCell(page);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    expect(await readStoredSession(page)).toBeNull();
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.reload();
    await expect(page.locator('.player-page')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('.session-goal-card')).toHaveCount(0);
    expect(await readStoredSession(page)).toBeNull();
  });

  test('painting completion remains available without a session-goal celebration or XP copy', async ({ page }) => {
    const coloringId = await createSmallColoring(page, { leaveWorkAfterFirstGoal: true });
    await openPlayer(page, coloringId, 'sessionGoals=control');
    await expect(page.locator('.session-goal-card')).toHaveCount(0);
    await tapActiveWorkCell(page);
    await expect(page.locator('.save-status')).toBeVisible();
    await expect(page.locator('.completion-overlay')).toHaveCount(0);
    await expect(page.locator('.player-page')).not.toContainText(/XP|уровень|серия/i);
    expect(await readStoredSession(page)).toBeNull();
  });

  test('default recovery treatment hides goals but preserves painting save and server revision', async ({ page }) => {
    const coloringId = await createSmallColoring(page);
    await openPlayer(page, coloringId);

    await expect(page.locator('.player-page')).toHaveAttribute('data-session-goals-mode', 'hidden');
    await expect(page.locator('.session-goal-card')).toHaveCount(0);
    await expect(page.locator('.coloring-task-summary')).toBeVisible();
    await expect(page.locator('.coloring-canvas')).toBeVisible();
    await expect(page.locator('.coloring-dock')).toBeVisible();
    await expect(page.locator('.save-status')).toBeVisible();
    expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('splint:session-goals:')))).toEqual([]);

    const saveResponsePromise = page.waitForResponse((response) => (
      response.url().includes('/progress/actions')
      && response.request().method() === 'POST'
      && response.status() === 200
    ), { timeout: 10000 });
    await tapActiveWorkCell(page);
    const saveResponse = await saveResponsePromise;
    const saved = await saveResponse.json();

    expect(Number(saved.revision)).toBeGreaterThan(0);
    expect(Array.isArray(saved.filled)).toBe(true);
    expect(saved.filled.some((value) => Number(value) !== -1)).toBe(true);
    expect(saved).toHaveProperty('rewards');
    await expect(page.locator('.session-goal-card')).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('splint:session-goals:')))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('explicit hidden treatment is deterministic and keeps the Canvas target surface', async ({ page }) => {
    const coloringId = await createSmallColoring(page);
    await openPlayer(page, coloringId, 'sessionGoals=hidden');

    await expect(page.locator('.player-page')).toHaveAttribute('data-session-goals-mode', 'hidden');
    await expect(page.locator('.session-goal-card')).toHaveCount(0);
    await expect(page.locator('.coloring-task-summary')).toBeVisible();
    await expect(page.locator('.coloring-canvas')).toBeVisible();
  });

  test('core-feel suppresses an explicit goal-card control override but keeps painting guidance', async ({ page }) => {
    await page.goto('/?coreFeel=b&coreSubject=corefeel_goals_override&sessionGoals=control');

    const player = page.locator('.player-page');
    await expect(player).toBeVisible({ timeout: 10000 });
    await waitForColoringSessionReady(page, { 'data-core-feel-variant': 'b' }, 'core feel goal override');
    await expect(player).toHaveAttribute('data-session-goals-mode', 'control');
    await expect(player).toHaveAttribute('data-session-goals-visible', 'false');
    await expect(page.locator('.session-goal-card')).toHaveCount(0);
    await expect(page.locator('[data-core-feel-hint]')).toContainText('светлому контуру');
    await expect(page.locator('canvas.coloring-canvas')).toHaveAttribute('data-active-work-cells', /\d/);
    expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('splint:session-goals:')))).toEqual([]);
  });
});
