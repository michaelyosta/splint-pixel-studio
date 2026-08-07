import { test, expect } from '@playwright/test';

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

async function openPlayer(page, coloringId = null) {
  if (coloringId) {
    await page.goto(`/?coloring=${encodeURIComponent(coloringId)}`);
  } else {
    await page.goto('/');
  }
  if (!coloringId) {
    const card = page.locator('.home-featured-card, .home-continue-card, .home-art-card').first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.click();
  }
  await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
  await dismissOnboarding(page);
}

async function openFirstCatalogPlayer(page) {
  await page.goto('/');
  const card = page.locator('.home-featured-card, .home-continue-card, .home-art-card').first();
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.click();
  await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
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
    await openFirstCatalogPlayer(page);

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
    await openFirstCatalogPlayer(page);

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

    // The active interval is paused; elapsed must stay frozen while offline.
    await page.waitForTimeout(1200);
    expect(Number(await card.getAttribute('data-elapsed-ms'))).toBe(pausedElapsed);

    const stored = await readStoredSession(page);
    expect(stored).toBeTruthy();
    const templateId = stored.key.split(':').at(-1);
    expect(templateId).toBeTruthy();

    await openPlayer(page, templateId);
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
    await openPlayer(page, coloringId);

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

    await expect.poll(async () => await card.getAttribute('data-goal-id'), { timeout: 10000 })
      .not.toBe('first-progress');
    await expect(card).toHaveAttribute('data-goal-status', 'running');
    await expect(card).toHaveAttribute('data-painted', 'true');
    await expect(card).toHaveAttribute('data-celebration', 'completed');
    await expect(page.locator('.session-goal-celebration')).toBeVisible();
    await expect(page.locator('.completion-overlay')).toHaveCount(0);

    expect(serverXp).toBeGreaterThan(0);
    await expect(card).toContainText(`+${serverXp} XP`);
    await expect(card).toContainText('подтверждено сервером');

    const nextGoalId = await card.getAttribute('data-goal-id');
    expect(nextGoalId).toBe('picture');
    await expect(card).toContainText('Вся картина');

    await page.locator('.session-goal-next').click();
    await expect(card).toHaveAttribute('data-celebration', '');
  });
});
