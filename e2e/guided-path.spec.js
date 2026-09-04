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

async function expectNavigationBounded(page, { scrollable }) {
  const metrics = await page.evaluate(() => {
    const frame = document.querySelector('.telegram-frame');
    const content = document.querySelector('.screen-content');
    const navigation = document.querySelector('.app-tab-bar');
    const frameRect = frame.getBoundingClientRect();
    const navigationRect = navigation.getBoundingClientRect();
    return {
      frameTop: frameRect.top,
      frameBottom: frameRect.bottom,
      navigationTop: navigationRect.top,
      navigationBottom: navigationRect.bottom,
      contentClientHeight: content.clientHeight,
      contentScrollHeight: content.scrollHeight,
    };
  });
  expect(metrics.navigationTop).toBeGreaterThanOrEqual(metrics.frameTop - 0.5);
  expect(metrics.navigationBottom).toBeLessThanOrEqual(metrics.frameBottom + 0.5);
  if (scrollable) expect(metrics.contentScrollHeight).toBeGreaterThan(metrics.contentClientHeight);
  else expect(metrics.contentScrollHeight).toBeLessThanOrEqual(metrics.contentClientHeight + 1);

  if (!scrollable) return;
  const before = { top: metrics.navigationTop, bottom: metrics.navigationBottom };
  const after = await page.evaluate(() => {
    const content = document.querySelector('.screen-content');
    content.scrollTop = content.scrollHeight;
    const navigationRect = document.querySelector('.app-tab-bar').getBoundingClientRect();
    return { top: navigationRect.top, bottom: navigationRect.bottom, scrollTop: content.scrollTop };
  });
  expect(after.scrollTop).toBeGreaterThan(0);
  expect(after.top).toBeCloseTo(before.top, 1);
  expect(after.bottom).toBeCloseTo(before.bottom, 1);
}

async function markNavigationInstance(page, marker) {
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' });
  await navigation.evaluate((node, value) => { node.dataset.e2eInstance = value; }, marker);
  return navigation;
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

test('catalog is the default and primary navigation has exactly three product tabs', async ({ page }) => {
  await primeLocalStorage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 15000 });
  await page.addStyleTag({ content: '.catalog-page, .profile-page { min-height: 1500px; }' });
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' });
  await expect(navigation.getByRole('button')).toHaveCount(3);
  expect(await navigation.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))).toEqual(['Каталог', 'Создать', 'Профиль']);
  await expect(navigation).not.toContainText(/Главная|Сообщество|Gallery|Store|Achievements/i);
  await expectNavigationBounded(page, { scrollable: true });

  await markNavigationInstance(page, 'catalog-first');
  await navigation.getByRole('button', { name: 'Создать' }).click();
  await expect(page.locator('.create-hub-page')).toBeVisible();
  await expect(navigation).not.toHaveAttribute('data-e2e-instance', 'catalog-first');
  await expectNavigationBounded(page, { scrollable: false });

  await markNavigationInstance(page, 'create');
  await navigation.getByRole('button', { name: 'Профиль' }).click();
  await expect(page.locator('[data-profile-showcase="true"]')).toBeVisible({ timeout: 15000 });
  await expect(navigation).not.toHaveAttribute('data-e2e-instance', 'create');
  await expectNavigationBounded(page, { scrollable: true });

  await markNavigationInstance(page, 'profile');
  await navigation.getByRole('button', { name: 'Каталог' }).click();
  await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 15000 });
  await expect(navigation).not.toHaveAttribute('data-e2e-instance', 'profile');
  await expectNavigationBounded(page, { scrollable: true });

  const collectionsResponse = await page.request.get('/api/meta/collections');
  expect(collectionsResponse.ok()).toBe(true);
  const freePack = (await collectionsResponse.json()).find((collection) => collection.pack_type !== 'premium');
  expect(freePack).toBeTruthy();
  await page.goto(`/?pack=${encodeURIComponent(freePack.id)}`);
  await expect(page.locator('.catalog-heading h1')).toHaveText(freePack.title, { timeout: 15000 });
  await expect(page.locator('.catalog-page')).toContainText('КОЛЛЕКЦИЯ');
});

test('public profile deep link opens a content-first showcase without progression UI', async ({ page }) => {
  await page.addInitScript(() => {
    const artworkId = 'persisted-resume-must-not-win';
    localStorage.setItem('splint:resume-current:v1:anonymous', JSON.stringify({ artworkId, route: 'play', savedAt: Date.now() }));
    localStorage.setItem(`splint:resume:v1:anonymous:${artworkId}`, JSON.stringify({
      version: 1,
      artworkId,
      route: 'play',
      progressRevision: 0,
    }));
  });
  await page.goto('/?profile=user_lenaart');
  const showcase = page.locator('[data-profile-showcase="true"]');
  await expect(showcase).toBeVisible({ timeout: 15000 });
  await expect(showcase).toContainText('КОЛЛЕКЦИЯ АВТОРА');
  await expect(showcase).not.toContainText(/XP|уровень|серия дней|достижения/i);
  await expect(page.locator('.player-page')).toHaveCount(0);
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' });
  await expect(navigation.getByRole('button')).toHaveCount(3);
  await navigation.getByRole('button', { name: 'Каталог' }).click();
  await navigation.getByRole('button', { name: 'Профиль' }).click();
  await expect(page.locator('[data-profile-showcase="true"]')).toContainText('МОЯ КОЛЛЕКЦИЯ', { timeout: 15000 });
  await expect(page.locator('[data-profile-showcase="true"]')).not.toContainText('КОЛЛЕКЦИЯ АВТОРА');
});

test('completion hands the finished work to profile or catalog without progression rewards', async ({ page }) => {
  await primeLocalStorage(page);
  const coloringId = await createAndCompleteSmallColoring(page);
  await page.goto(`/?coloring=${encodeURIComponent(coloringId)}`);
  await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
  await dismissOnboarding(page);

  await expect(page.locator('.completion-overlay')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-choice-window="completion"]')).toBeVisible();
  await expect(page.locator('.completion-dialog')).not.toContainText(/XP|уровень|серия|достижение/i);
  const profile = page.locator('[data-completion-choice][data-choice-id="open_profile"]');
  await expect(profile).toBeVisible();
  await profile.click();
  await expect(page.locator('[data-profile-showcase="true"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.profile-created-section')).toContainText('Guided path e2e');
  await page.getByRole('button', { name: 'Открыть Guided path e2e' }).last().click();
  await expect(page.locator('.player-page')).toBeVisible({ timeout: 15000 });
});
