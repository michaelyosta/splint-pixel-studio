import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const evidenceDir = resolve(process.cwd(), 'docs', 'evidence', 'session-goals-2026-08-07');
const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];
const captured = [];

async function primeLocalStorage(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('splint_onboarding_version', '2');
    } catch {
      // Optional; onboarding is dismissed defensively below.
    }
  });
}

async function dismissOnboarding(page) {
  const skip = page.locator('.onboarding-card .secondary-button');
  await skip.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  if (await skip.isVisible().catch(() => false)) await skip.click({ force: true });
}

async function openFirstCatalogPlayer(page, search = '') {
  const query = String(search).replace(/^\?/, '');
  await page.goto(query ? `/?${query}` : '/');
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

async function collectMetrics(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        left: Math.round(box.left),
        top: Math.round(box.top),
        right: Math.round(box.right),
        bottom: Math.round(box.bottom),
        width: Math.round(box.width),
        height: Math.round(box.height),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    };
    const overlap = (first, second) => {
      if (!first || !second) return null;
      return !(first.right <= second.left || second.right <= first.left || first.bottom <= second.top || second.bottom <= first.top);
    };
    const topbar = rect('.player-topbar');
    const hint = rect('.player-hint');
    const card = rect('.session-goal-card');
    const canvasArea = rect('.coloring-session') || rect('.progressive-coloring-session') || rect('.player-canvas-area');
    const textScroll = Array.from(document.querySelectorAll('.session-goal-card *'))
      .filter((element) => !element.classList.contains('sr-only') && element.scrollWidth > element.clientWidth + 1)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      cardWithinViewport: card ? card.left >= 0 && card.right <= window.innerWidth : null,
      cardClearOfCanvas: card && canvasArea ? !overlap(card, canvasArea) : null,
      topbar,
      hint,
      goalCard: card,
      canvasArea,
      overlaps: {
        cardTopbar: overlap(card, topbar),
        cardCanvas: overlap(card, canvasArea),
      },
      textScroll,
      textScrollCount: textScroll.length,
    };
  });
}

test.describe('Session goals visual evidence', () => {
  test.skip(process.env.SESSION_GOALS_EVIDENCE !== '1', 'run with SESSION_GOALS_EVIDENCE=1');

  test.afterAll(() => {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(
      resolve(evidenceDir, 'metrics.json'),
      JSON.stringify({
        capturedAt: new Date().toISOString(),
        screens: captured,
      }, null, 2),
    );
  });

  for (const viewport of viewports) {
    test(`capture session-goal player at ${viewport.width}px`, async ({ page }) => {
      mkdirSync(evidenceDir, { recursive: true });
      await page.context().setExtraHTTPHeaders({ 'X-User-Id': `e2e_goals_evidence_${viewport.width}` });
      await primeLocalStorage(page);
      await page.setViewportSize(viewport);
      await openFirstCatalogPlayer(page, 'sessionGoals=control');

      const card = page.locator('.session-goal-card');
      await expect(card).toBeVisible({ timeout: 5000 });
      await expect(card).toHaveAttribute('data-painted', 'false');
      const idleMetrics = await collectMetrics(page);
      await page.screenshot({ path: resolve(evidenceDir, `player-goal-idle-${viewport.width}.png`) });

      await tapActiveWorkCell(page);
      await expect(card).toHaveAttribute('data-painted', 'true');
      await expect.poll(async () => Number(await card.getAttribute('data-elapsed-ms')), { timeout: 3000 })
        .toBeGreaterThan(0);
      const runningMetrics = await collectMetrics(page);
      await page.screenshot({ path: resolve(evidenceDir, `player-goal-running-${viewport.width}.png`) });

      captured.push({ viewport, idle: idleMetrics, running: runningMetrics });
    });
  }
});
