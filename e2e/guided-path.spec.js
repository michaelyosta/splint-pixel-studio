import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';

const BOT_TOKEN = 'e2e-bot-token';

function buildValidTelegramInitData(user) {
  const params = new URLSearchParams({
    query_id: 'AAHdF6iqAAAAAN0X6Ko',
    user: JSON.stringify(user),
    auth_date: String(Math.floor(Date.now() / 1000)),
  });
  const dataCheckString = [...params.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}

async function installTelegramSession(page, { platform, userId }) {
  const initData = buildValidTelegramInitData({ id: userId, username: `nav_${platform}_${userId}`, first_name: 'Navigation' });
  await page.route('https://telegram.org/js/telegram-web-app.js', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: 'window.Telegram = window.Telegram || {};',
    });
  });
  await page.addInitScript(({ signedInitData, telegramPlatform }) => {
    const listeners = new Map();
    window.Telegram = {
      WebApp: {
        initData: signedInitData,
        initDataUnsafe: {},
        platform: telegramPlatform,
        version: '8.0',
        colorScheme: 'dark',
        viewportHeight: 844,
        viewportStableHeight: 844,
        safeAreaInset: { top: 47, right: 0, bottom: 34, left: 0 },
        contentSafeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 },
        ready() {},
        expand() {},
        onEvent(name, handler) {
          if (!listeners.has(name)) listeners.set(name, []);
          listeners.get(name).push(handler);
        },
        offEvent(name, handler) {
          const handlers = listeners.get(name) || [];
          const index = handlers.indexOf(handler);
          if (index >= 0) handlers.splice(index, 1);
        },
      },
    };
  }, { signedInitData: initData, telegramPlatform: platform });
}

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

async function expectNavigationBounded(page, { scrollable, selector = '.app-tab-bar' }) {
  const metrics = await page.evaluate((navigationSelector) => {
    const frame = document.querySelector('.telegram-frame');
    const content = document.querySelector('.screen-content');
    const navigation = document.querySelector(navigationSelector);
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
  }, selector);
  expect(metrics.navigationBottom - metrics.navigationTop).toBeGreaterThan(0);
  expect(metrics.navigationTop).toBeGreaterThanOrEqual(metrics.frameTop - 0.5);
  expect(metrics.navigationBottom).toBeLessThanOrEqual(metrics.frameBottom + 0.5);
  if (scrollable) expect(metrics.contentScrollHeight).toBeGreaterThan(metrics.contentClientHeight);
  else expect(metrics.contentScrollHeight).toBeLessThanOrEqual(metrics.contentClientHeight + 1);

  if (!scrollable) return;
  const before = { top: metrics.navigationTop, bottom: metrics.navigationBottom };
  const after = await page.evaluate((navigationSelector) => {
    const content = document.querySelector('.screen-content');
    content.scrollTop = content.scrollHeight;
    const navigationRect = document.querySelector(navigationSelector).getBoundingClientRect();
    return { top: navigationRect.top, bottom: navigationRect.bottom, scrollTop: content.scrollTop };
  }, selector);
  expect(after.scrollTop).toBeGreaterThan(0);
  expect(after.top).toBeCloseTo(before.top, 1);
  expect(after.bottom).toBeCloseTo(before.bottom, 1);
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
  await expect(navigation).toHaveAttribute('data-navigation-placement', 'bottom');
  await expect(page.locator('.primary-navigation--top')).toHaveCount(0);
  await expect(navigation.getByRole('button')).toHaveCount(3);
  expect(await navigation.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))).toEqual(['Каталог', 'Создать', 'Профиль']);
  await expect(navigation).not.toContainText(/Главная|Сообщество|Gallery|Store|Achievements/i);
  await expectNavigationBounded(page, { scrollable: true });

  await navigation.getByRole('button', { name: 'Создать' }).click();
  await expect(page.locator('.create-hub-page')).toBeVisible();
  await expectNavigationBounded(page, { scrollable: false });

  await navigation.getByRole('button', { name: 'Профиль' }).click();
  await expect(page.locator('[data-profile-showcase="true"]')).toBeVisible({ timeout: 15000 });
  await expectNavigationBounded(page, { scrollable: true });

  await navigation.getByRole('button', { name: 'Каталог' }).click();
  await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 15000 });
  await expectNavigationBounded(page, { scrollable: true });

  const collectionsResponse = await page.request.get('/api/meta/collections');
  expect(collectionsResponse.ok()).toBe(true);
  const freePack = (await collectionsResponse.json()).find((collection) => collection.pack_type !== 'premium');
  expect(freePack).toBeTruthy();
  await page.goto(`/?pack=${encodeURIComponent(freePack.id)}`);
  await expect(page.locator('.catalog-heading h1')).toHaveText(freePack.title, { timeout: 15000 });
  await expect(page.locator('.catalog-page')).toContainText('КОЛЛЕКЦИЯ');
});

test('real Telegram iOS keeps bottom primary navigation in a top-level portal across long and short routes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'Mobile iPhone', 'Telegram iOS contract runs in the iPhone project');
  await primeLocalStorage(page);
  await installTelegramSession(page, { platform: 'ios', userId: 515151 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 15000 });
  await page.addStyleTag({ content: '.catalog-page, .profile-page { min-height: 1500px; }' });

  const navigation = page.getByRole('navigation', { name: 'Основная навигация' });
  await expect(navigation).toHaveAttribute('data-navigation-placement', 'portal-bottom');
  await expect(navigation.getByRole('button')).toHaveCount(3);
  await expect(navigation).toHaveClass(/app-tab-bar/);
  await expect(page.locator('.primary-navigation--top')).toHaveCount(0);
  await expect(page.locator('.ios-primary-navigation-host')).toHaveCount(1);
  await expect(page.locator('.app-container .app-tab-bar')).toHaveCount(0);
  expect(await navigation.evaluate((node) => node.parentElement?.classList.contains('ios-primary-navigation-host'))).toBe(true);
  expect(await navigation.evaluate((node) => node.parentElement?.parentElement?.classList.contains('telegram-frame'))).toBe(true);
  await navigation.evaluate((node) => { node.dataset.e2eStableInstance = 'ios-primary'; });

  const routes = [
    { id: 'catalog', label: 'Каталог', visible: '.catalog-page', scrollable: true },
    { id: 'create', label: 'Создать', visible: '.create-hub-page', scrollable: false },
    { id: 'profile', label: 'Профиль', visible: '[data-profile-showcase="true"]', scrollable: true },
    { id: 'catalog', label: 'Каталог', visible: '.catalog-page', scrollable: true },
  ];

  for (const [index, route] of routes.entries()) {
    if (index > 0) await navigation.getByRole('button', { name: route.label }).click();
    await expect(page.locator(route.visible)).toBeVisible({ timeout: 15000 });
    await expect(navigation).toHaveAttribute('data-e2e-stable-instance', 'ios-primary');
    await expect(navigation.getByRole('button', { name: route.label })).toHaveAttribute('aria-current', 'page');
    await expectNavigationBounded(page, { scrollable: route.scrollable, selector: '.primary-navigation--portal-bottom' });
  }
});

test('real Telegram Android keeps the existing bottom primary navigation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'Mobile Pixel', 'Telegram Android contract runs in the Pixel project');
  await primeLocalStorage(page);
  await installTelegramSession(page, { platform: 'android', userId: 616161 });
  await page.goto('/');
  await expect(page.locator('.catalog-page')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.primary-navigation--top')).toHaveCount(0);
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' });
  await expect(navigation).toHaveAttribute('data-navigation-placement', 'bottom');
  await expect(navigation).toHaveClass(/app-tab-bar/);
  await expect(navigation).toBeVisible();
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
