import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const evidenceDir = resolve('docs/evidence/special-help-onboarding-responsive');
const SPECIAL_HELP_LABEL = '\u041e\u0441\u043e\u0431\u044b\u0435 \u043a\u043b\u0435\u0442\u043a\u0438';

async function createForCohort(page, { cohort, userId }) {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': userId });
  const fixtureResponse = await page.request.post('/api/__e2e/seed-cohort-template', {
    data: {
      cohort,
      storage: 'legacy',
      size: { width: 160, height: 160 },
    },
  });
  expect(fixtureResponse.ok()).toBe(true);
  const fixture = await fixtureResponse.json();
  expect(fixture.cohort).toBe(cohort);
  expect(fixture.storage).toBe('legacy');
  expect(fixture.size).toEqual({ width: 160, height: 160 });
  const progressResponse = await page.request.get(`/api/colorings/${fixture.id}/progress`);
  expect(progressResponse.ok()).toBe(true);
  const progress = await progressResponse.json();
  return { created: { id: fixture.id }, progress };
}

function requestedWidth(testInfo) {
  const forced = Number(process.env.SPECIAL_HELP_WIDTH);
  if (Number.isInteger(forced) && forced >= 320 && forced <= 480) return forced;
  if (testInfo.project.name === 'Mobile iPhone') return 430;
  if (testInfo.project.name === 'Mobile Pixel') return 412;
  return 390;
}

function screenshotPath(testInfo, width, suffix) {
  return resolve(evidenceDir, `${testInfo.project.name}-${width}-${suffix}.png`);
}

async function inspectBottomSheets(page) {
  return page.evaluate(() => {
    const isPainted = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    const isFocusable = (element) => {
      if (element.matches('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')) {
        return !element.disabled;
      }
      return false;
    };
    const sheets = [...document.querySelectorAll('.bottom-sheet')];
    const overlays = [...document.querySelectorAll('.bottom-sheet-overlay')];
    const hiddenFocusable = sheets
      .filter((sheet) => !isPainted(sheet))
      .flatMap((sheet) => [...sheet.querySelectorAll('*')])
      .filter(isFocusable)
      .map((element) => element.outerHTML.slice(0, 160));
    const animations = [...overlays, ...sheets]
      .flatMap((element) => element.getAnimations().map((animation) => ({
        element: element.className,
        playState: animation.playState,
        currentTime: animation.currentTime,
        duration: animation.effect?.getComputedTiming?.().duration ?? null,
      })));
    return {
      overlayCount: overlays.length,
      sheetCount: sheets.length,
      visibleOverlayCount: overlays.filter(isPainted).length,
      visibleSheetCount: sheets.filter(isPainted).length,
      hiddenFocusable,
      activeAnimations: animations.filter((animation) => animation.playState !== 'finished'),
      animationSnapshot: animations,
      activeElement: document.activeElement?.className || document.activeElement?.tagName || '',
    };
  });
}

async function waitForSettledBottomSheet(page) {
  await expect.poll(async () => {
    const state = await inspectBottomSheets(page);
    return {
      overlayCount: state.overlayCount,
      sheetCount: state.sheetCount,
      visibleOverlayCount: state.visibleOverlayCount,
      visibleSheetCount: state.visibleSheetCount,
      hiddenFocusable: state.hiddenFocusable,
      activeAnimations: state.activeAnimations,
    };
  }, { timeout: 5000 }).toEqual({
    overlayCount: 1,
    sheetCount: 1,
    visibleOverlayCount: 1,
    visibleSheetCount: 1,
    hiddenFocusable: [],
    activeAnimations: [],
  });
}

async function assertWithinViewport(page, locator) {
  const viewport = page.viewportSize();
  const box = await locator.boundingBox();
  expect(viewport).toBeTruthy();
  expect(box).toBeTruthy();
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function assertFocusTrap(page, { first, last, firstClass, lastClass }) {
  await first.focus();
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => page.evaluate(() => document.activeElement?.className || '')).toContain(lastClass);

  await last.focus();
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => document.activeElement?.className || '')).toContain(firstClass);
}

test.describe('Special help onboarding responsive evidence', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await page.route('https://telegram.org/js/telegram-web-app.js', async (route) => {
      await route.fulfill({
        contentType: 'application/javascript',
        body: 'window.Telegram = window.Telegram || { WebApp: { ready() {} } };',
      });
    });
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('splint_onboarding_version');
        localStorage.removeItem('splint_special_help_v1');
      } catch {
        // Local storage can be unavailable in strict privacy contexts.
      }
    });
    await page.setViewportSize({ width: requestedWidth(testInfo), height: 844 });
  });

  test('treatment onboarding and help stay visible, bounded, reduced-motion safe, and keyboard-trapped', async ({ page }, testInfo) => {
    test.setTimeout(120000);
    mkdirSync(evidenceDir, { recursive: true });
    const width = requestedWidth(testInfo);
    const reducedMotion = process.env.SPECIAL_HELP_REDUCED_MOTION === '1'
      || testInfo.project.name === 'Mobile iPhone';
    if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });

    const { created } = await createForCohort(page, {
      cohort: 'treatment',
      userId: `${testInfo.project.name.replace(/\s+/g, '_')}_special_help_treatment_${width}`,
    });
    await page.goto(`/?coloring=${created.id}`);

    const card = page.locator('.onboarding-card');
    await expect(card).toBeVisible({ timeout: 15000 });
    await assertWithinViewport(page, card);
    await expect.poll(() => page.evaluate(() => document.activeElement?.className || '')).toContain('onboarding-card');

    const cardButtons = card.locator('button');
    const firstCardButton = cardButtons.first();
    const lastCardButton = cardButtons.last();
    await assertFocusTrap(page, {
      first: firstCardButton,
      last: lastCardButton,
      firstClass: 'primary-button',
      lastClass: 'secondary-button',
    });
    await page.screenshot({
      path: screenshotPath(testInfo, width, reducedMotion ? 'onboarding-reduced-motion' : 'onboarding'),
      fullPage: false,
    });

    const stepCount = await card.locator('.onboarding-dots span').count();
    for (let step = 0; step < stepCount - 1; step += 1) {
      await firstCardButton.click();
    }
    await expect(page.locator('[data-special-help-intro]')).toBeVisible();
    await assertWithinViewport(page, card);
    await page.screenshot({
      path: screenshotPath(testInfo, width, reducedMotion ? 'special-intro-reduced-motion' : 'special-intro'),
      fullPage: false,
    });
    await card.locator('.primary-button').click();
    await expect(page.locator('.onboarding-overlay')).toHaveCount(0);

    await page.locator('.player-menu-btn').click();
    const helpEntry = page.locator('.bottom-sheet-actions button')
      .filter({ hasText: SPECIAL_HELP_LABEL });
    await expect(helpEntry).toBeVisible();
    await waitForSettledBottomSheet(page);
    await helpEntry.click();

    const sheet = page.locator('[data-special-help-open] .special-help-sheet');
    await expect(sheet).toBeVisible();
    await assertWithinViewport(page, sheet);
    await expect.poll(() => page.evaluate(() => document.activeElement?.className || '')).toContain('special-help-sheet');
    await assertFocusTrap(page, {
      first: sheet.locator('.special-help-close'),
      last: sheet.locator('.primary-button'),
      firstClass: 'special-help-close',
      lastClass: 'primary-button',
    });
    if (reducedMotion) {
      const durations = await page.evaluate(() => [
        getComputedStyle(document.querySelector('.special-help-overlay')).animationDuration,
        getComputedStyle(document.querySelector('.special-help-sheet')).animationDuration,
      ]);
      expect(durations.every((value) => Number.parseFloat(value) <= 0.01)).toBe(true);
    }
    await page.screenshot({
      path: screenshotPath(testInfo, width, reducedMotion ? 'help-reduced-motion' : 'help'),
      fullPage: false,
    });

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-special-help-open]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.className || '')).toContain('player-menu-btn');
  });

  test('control onboarding has no special-cell entry or help surface', async ({ page }, testInfo) => {
    test.setTimeout(120000);
    mkdirSync(evidenceDir, { recursive: true });
    const width = requestedWidth(testInfo);
    const { created, progress } = await createForCohort(page, {
      cohort: 'control',
      userId: `${testInfo.project.name.replace(/\s+/g, '_')}_special_help_control_${width}`,
    });
    expect(progress.specials).toEqual([]);
    await page.goto(`/?coloring=${created.id}`);

    const card = page.locator('.onboarding-card');
    await expect(card).toBeVisible({ timeout: 15000 });
    await assertWithinViewport(page, card);
    expect(await card.locator('.onboarding-dots span').count()).toBe(3);
    await expect(page.locator('[data-special-help-intro]')).toHaveCount(0);
    await card.locator('.secondary-button').click();
    await expect(page.locator('.onboarding-overlay')).toHaveCount(0);

    await page.locator('.player-menu-btn').click();
    const controlSheet = page.locator('.bottom-sheet');
    await expect(controlSheet).toBeVisible();
    await expect(page.locator('.bottom-sheet-actions button')
      .filter({ hasText: SPECIAL_HELP_LABEL })).toHaveCount(0);
    await waitForSettledBottomSheet(page);
    await expect.poll(async () => {
      const state = await inspectBottomSheets(page);
      return state.activeElement;
    }).toContain('bottom-sheet');
    await page.screenshot({
      path: screenshotPath(testInfo, width, 'control'),
      fullPage: false,
    });
  });
});
