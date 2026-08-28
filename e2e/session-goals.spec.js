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
    const card = page.locator('.home-featured-card, .home-continue-card, .home-art-card').first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.click();
  }
  await expect(page.locator('.player-page')).toBeVisible({ timeout: 60000 });
  await dismissOnboarding(page);
}

async function openFirstCatalogPlayer(page, search = '') {
  const query = String(search).replace(/^\?/, '');
  await page.goto(query ? `/?${query}` : '/');
  const card = page.locator('.home-featured-card, .home-continue-card, .home-art-card').first();
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

async function createSmallColoring(page) {
  const cells = Array.from({ length: 64 }, () => 0);
  cells[27] = 1;
  cells[28] = 1;
  cells[29] = 1;
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

async function paintUntilFirstGoalDone(page, card, target) {
  const painted = new Set();
  for (let index = 0; index < target; index += 1) {
    if (Number(await card.getAttribute('data-done-cells')) >= target) break;
    const before = Number(await card.getAttribute('data-done-cells'));
    const activeHandle = await page.waitForFunction(() => {
      const attribute = document.querySelector('canvas.coloring-canvas')?.getAttribute('data-active-work-cells') || '';
      return attribute.split(',').map(Number).filter(Boolean);
    }, null, { timeout: 5000 });
    const activeCells = await activeHandle.jsonValue();
    const current = activeCells.map(Number);
    const nextIndex = current.find((cellIndex) => !painted.has(cellIndex)) ?? current[0];
    painted.add(nextIndex);
    await tapCell(page, nextIndex);
    await expect.poll(async () => Number(await card.getAttribute('data-done-cells')), { timeout: 10000 })
      .toBeGreaterThan(before);
  }
}

test.describe('Session goals', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await page.context().setExtraHTTPHeaders({ 'X-User-Id': `e2e_goals_${testInfo.testId}` });
    await primeLocalStorage(page);
  });

  test('goal is visible before paint, timer starts on first paint, and progress updates', async ({ page }) => {
    await openFirstCatalogPlayer(page, 'sessionGoals=control');

    const card = page.locator('.session-goal-card');
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card).toHaveAttribute('data-goal-id', 'first-progress');
    await expect(card).toHaveAttribute('data-painted', 'false');
    await expect(card).toHaveAttribute('data-target-cells', '10');
    await expect(card).toContainText('0:30');

    const before = Number(await card.getAttribute('data-done-cells'));
    await tapActiveWorkCell(page);
    await expect(card).toHaveAttribute('data-painted', 'true');
    await expect.poll(async () => Number(await card.getAttribute('data-done-cells')), { timeout: 8000 }).toBeGreaterThan(before);
    await expect.poll(async () => Number(await card.getAttribute('data-elapsed-ms')), { timeout: 3000 }).toBeGreaterThan(0);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('offline pause freezes elapsed time and reload/reopen reconstructs the same goal without rewards', async ({ page }) => {
    await openFirstCatalogPlayer(page, 'sessionGoals=control');

    const card = page.locator('.session-goal-card');
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card).toHaveAttribute('data-goal-id', 'first-progress');
    await tapActiveWorkCell(page);
    await expect(card).toHaveAttribute('data-painted', 'true');
    await expect.poll(async () => Number(await card.getAttribute('data-elapsed-ms')), { timeout: 3000 })
      .toBeGreaterThan(0);

    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(card).toHaveAttribute('data-goal-status', 'paused');
    const pausedElapsed = Number(await card.getAttribute('data-elapsed-ms'));

    await expect.poll(async () => {
      const stored = await readStoredSession(page);
      return stored?.data?.status === 'paused'
        && Number(stored.data.elapsedMs) >= pausedElapsed;
    }, { timeout: 5000 }).toBe(true);

    // The active interval is paused; sample it for a bounded interval without
    // relying on an unbounded arbitrary sleep.
    const pausedAt = Date.now();
    await expect.poll(async () => (
      Number(await card.getAttribute('data-elapsed-ms')) === pausedElapsed
      && Date.now() - pausedAt >= 1000
    ), {
      timeout: 3000,
      intervals: [250, 250, 250, 250, 250, 250],
      message: `offline goal timer did not remain at ${pausedElapsed}ms for the bounded observation window`,
    }).toBe(true);

    const stored = await readStoredSession(page);
    expect(stored).toBeTruthy();
    const templateId = stored.key.split(':').at(-1);
    expect(templateId).toBeTruthy();

    await openPlayer(page, templateId, 'sessionGoals=control');
    await expect(card).toHaveAttribute('data-goal-id', 'first-progress');
    await expect(card).toHaveAttribute('data-painted', 'true');
    await expect(card).toHaveAttribute('data-goal-status', 'paused');
    const reloadedElapsed = Number(await card.getAttribute('data-elapsed-ms'));
    expect(reloadedElapsed).toBeGreaterThanOrEqual(pausedElapsed);
    expect(reloadedElapsed).toBeLessThanOrEqual(pausedElapsed + 1000);

    const storedAfterReopen = await readStoredSession(page);
    expect(storedAfterReopen.data).not.toHaveProperty('rewards');
    expect(storedAfterReopen.data).not.toHaveProperty('xp_awarded');
    expect(storedAfterReopen.data).not.toHaveProperty('xp');

    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(card).toHaveAttribute('data-goal-status', 'running');
    const resumedBase = Number(await card.getAttribute('data-elapsed-ms'));
    await expect.poll(async () => Number(await card.getAttribute('data-elapsed-ms')), { timeout: 3000 })
      .toBeGreaterThan(resumedBase);
  });

  test('completing the first goal shows a server-backed celebration and the next goal without a completion modal', async ({ page }) => {
    const coloringId = await createSmallColoring(page);
    await openPlayer(page, coloringId, 'sessionGoals=control');

    let serverXp = null;
    page.on('response', async (response) => {
      if (!response.url().includes('/progress/actions') || response.status() !== 200) return;
      const payload = await response.json().catch(() => null);
      serverXp = Number(payload?.rewards?.xp_awarded || 0);
    });

    const card = page.locator('.session-goal-card');
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card).toHaveAttribute('data-goal-id', 'first-progress');
    await expect(card).toHaveAttribute('data-target-cells', '3');

    await paintUntilFirstGoalDone(page, card, 3);

    let celebration;
    await expect.poll(async () => {
      celebration = await card.evaluate((element) => ({
        goalId: element.getAttribute('data-goal-id'),
        status: element.getAttribute('data-goal-status'),
        painted: element.getAttribute('data-painted'),
        celebration: element.getAttribute('data-celebration'),
        text: element.textContent,
      }));
      return celebration;
    }, {
      timeout: 30000,
      message: 'completed first session goal snapshot did not reach the expected server-backed celebration state',
    }).toMatchObject({
      goalId: 'picture',
      status: 'running',
      painted: 'true',
      celebration: 'completed',
    });
    await expect(page.locator('.session-goal-celebration')).toBeVisible();
    await expect(page.locator('.completion-overlay')).toHaveCount(0);

    expect(serverXp).toBeGreaterThan(0);
    expect(celebration.goalId).toBe('picture');
    expect(celebration.status).toBe('running');
    expect(celebration.painted).toBe('true');
    expect(celebration.celebration).toBe('completed');
    expect(celebration.text).toContain(`+${serverXp} XP`);
    expect(celebration.text).toContain('подтверждено сервером');
    expect(celebration.text).toContain('Вся картина');

    await page.locator('.session-goal-next').click({ force: true });
    await expect(card).toHaveAttribute('data-celebration', '');
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
