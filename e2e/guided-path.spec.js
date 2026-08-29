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
}

async function createAndCompleteSmallColoring(page) {
  const width = 8;
  const height = 8;
  const cells = new Array(width * height).fill(0);
  const create = await page.request.post('/api/colorings/create', {
    data: {
      title: 'Guided path e2e',
      description: 'Deterministic guided-path completion fixture',
      width,
      height,
      palette: ['#0B1522', '#2BD9FE'],
      cells,
      tileSize: 32,
    },
  });
  expect(create.ok()).toBe(true);
  const created = await create.json();

  let revision = 0;
  for (let offset = 0; offset < cells.length; offset += 64) {
    const count = Math.min(64, cells.length - offset);
    const changes = Array.from({ length: count }, (_, index) => ({ index: offset + index, color: 0 }));
    const response = await page.request.post(`/api/colorings/${created.id}/progress/actions`, {
      data: { changes, revision, clientBatchId: `guided-e2e-${offset}` },
    });
    expect(response.ok()).toBe(true);
    const saved = await response.json();
    revision = Number(saved.revision);
  }
  return created.id;
}

test.beforeEach(async ({ page }, testInfo) => {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': `e2e_guided_${testInfo.testId}` });
});

test('guided home shows one primary action and a bounded choice window', async ({ page }) => {
  await primeLocalStorage(page);
  await page.goto('/');
  await expect(page.locator('.home-page--guided')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-guided-primary="true"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-choice-window="home"]')).toBeVisible();
  await expect(page.locator('[data-recommendations="true"]')).toBeVisible();
  await expect(page.locator('.home-explore-row')).toBeVisible();
});

test('completion hands off to a committed choice, including an honest stop', async ({ page }) => {
  await primeLocalStorage(page);
  const coloringId = await createAndCompleteSmallColoring(page);
  await page.goto(`/?coloring=${encodeURIComponent(coloringId)}`);
  await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
  await dismissOnboarding(page);

  await expect(page.locator('.completion-overlay')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-choice-window="completion"]')).toBeVisible();
  const stop = page.locator('[data-completion-choice][data-choice-id="done_today"]');
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(page.locator('.home-page--guided')).toBeVisible({ timeout: 10000 });
});
