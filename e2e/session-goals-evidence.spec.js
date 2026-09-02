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
const completionPreview = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

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

async function openPlayer(page, coloringId, search = '') {
  const params = new URLSearchParams(String(search).replace(/^\?/, ''));
  params.set('coloring', coloringId);
  await page.goto('/?' + params);
  await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
  await dismissOnboarding(page);
}

async function createSmallColoring(page, suffix) {
  const cells = new Array(64).fill(0);
  [27, 28, 29].forEach((index) => { cells[index] = 1; });
  const response = await page.request.post('/api/colorings/create', {
    data: {
      title: 'Session-goal contract evidence ' + suffix,
      description: 'Deterministic 8x8 fixture for the no-goals player contract',
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

async function readSessionGoalStorage(page) {
  return page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith('splint:session-goals:')));
}

async function assertNoSessionGoalSurface(page) {
  const player = page.locator('.player-page');
  await expect(player).toHaveAttribute('data-session-goals-visible', 'false');
  await expect(page.locator('.session-goal-card')).toHaveCount(0);
  await expect(page.locator('.session-goal-timer')).toHaveCount(0);
  await expect(page.locator('.session-goal-celebration')).toHaveCount(0);
  await expect(page.locator('.session-goal-live')).toHaveCount(0);
  await expect(player).not.toContainText(/\bXP\b|уровень|серия/i);
  expect(await readSessionGoalStorage(page)).toEqual([]);
}

async function tapActiveWorkCell(page, painted = new Set()) {
  const canvas = page.locator('canvas.coloring-canvas');
  await expect(canvas).toBeVisible({ timeout: 10000 });
  await expect.poll(async () => (
    (await canvas.getAttribute('data-active-work-cells').catch(() => '')).split(',').filter(Boolean).length > 0
  ), { timeout: 5000 }).toBe(true);
  const activeCells = (await canvas.getAttribute('data-active-work-cells')).split(',').map(Number).filter(Number.isInteger);
  const templateWidth = Number(await canvas.getAttribute('data-template-width'));
  const viewport = page.locator('.coloring-canvas-viewport');
  const camera = {
    x: Number(await viewport.getAttribute('data-camera-x')),
    y: Number(await viewport.getAttribute('data-camera-y')),
    zoom: Number(await viewport.getAttribute('data-camera-zoom')),
  };
  const index = activeCells.find((cellIndex) => !painted.has(cellIndex)) ?? activeCells[0];
  painted.add(index);
  await canvas.click({
    force: true,
    position: {
      x: camera.x + ((index % templateWidth) + 0.5) * 32 * camera.zoom,
      y: camera.y + (Math.floor(index / templateWidth) + 0.5) * 32 * camera.zoom,
    },
  });
}

async function paintAndWaitForSave(page, coloringId, painted = new Set()) {
  const saveResponsePromise = page.waitForResponse((response) => (
    response.url().includes('/api/colorings/' + coloringId + '/progress/actions')
    && response.request().method() === 'POST'
    && response.status() === 200
  ));
  await tapActiveWorkCell(page, painted);
  const saveResponse = await saveResponsePromise;
  const saved = await saveResponse.json();
  expect(Number(saved.revision)).toBeGreaterThan(0);
  expect(Array.isArray(saved.filled)).toBe(true);
  expect(saved.filled.some((value) => Number(value) !== -1)).toBe(true);
  return saved;
}

async function applyProgressChanges(page, coloringId, changes, revision, resultDataUrl, batchKey) {
  let saved;
  let nextRevision = Number(revision);
  for (let offset = 0; offset < changes.length; offset += 64) {
    const batch = changes.slice(offset, offset + 64);
    const response = await page.request.post('/api/colorings/' + coloringId + '/progress/actions', {
      data: {
        changes: batch,
        revision: nextRevision,
        clientBatchId: batchKey + '-' + Math.floor(offset / 64),
        resultDataUrl: offset + 64 >= changes.length ? resultDataUrl : null,
      },
    });
    expect(response.ok()).toBe(true);
    saved = await response.json();
    nextRevision = Number(saved.revision);
  }
  return saved;
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
    const player = document.querySelector('.player-page');
    const playerText = player?.textContent || '';
    const topbar = rect('.player-topbar');
    const hint = rect('.player-hint');
    const card = rect('.session-goal-card');
    const canvasArea = rect('.coloring-session') || rect('.progressive-coloring-session') || rect('.player-canvas-area');
    const storageKeys = Object.keys(localStorage)
      .filter((key) => key.startsWith('splint:session-goals:'));
    const hasMetaCopy = /\bXP\b|уровень|серия/i.test(playerText);
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      topbar,
      hint,
      canvasArea,
      goalCard: card,
      overlaps: {
        cardTopbar: card && topbar ? !(card.right <= topbar.left || topbar.right <= card.left || card.bottom <= topbar.top || topbar.bottom <= card.top) : null,
        cardCanvas: card && canvasArea ? !(card.right <= canvasArea.left || canvasArea.right <= card.left || card.bottom <= canvasArea.top || canvasArea.bottom <= card.top) : null,
      },
      sessionGoalContract: {
        cardPresent: Boolean(card),
        timerPresent: Boolean(document.querySelector('.session-goal-timer')),
        celebrationPresent: Boolean(document.querySelector('.session-goal-celebration')),
        liveRegionPresent: Boolean(document.querySelector('.session-goal-live')),
        storageKeys,
        metaCopyPresent: hasMetaCopy,
      },
      completionOverlay: rect('.completion-overlay'),
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
    test('capture no-session-goals player at ' + viewport.width + 'px', async ({ page }) => {
      mkdirSync(evidenceDir, { recursive: true });
      await page.context().setExtraHTTPHeaders({ 'X-User-Id': 'e2e_goals_evidence_' + viewport.width });
      await primeLocalStorage(page);
      await page.setViewportSize(viewport);
      const coloringId = await createSmallColoring(page, String(viewport.width));
      // Keep the retired control query in this evidence path: a legacy link
      // must not restore the removed goal/timer surface.
      await openPlayer(page, coloringId, 'sessionGoals=control');

      await assertNoSessionGoalSurface(page);
      await expect(page.locator('.coloring-task-summary')).toBeVisible();
      await expect(page.locator('.coloring-dock')).toBeVisible();
      await expect(page.locator('.save-status')).toBeVisible();
      const idleMetrics = await collectMetrics(page);
      await page.screenshot({ path: resolve(evidenceDir, 'player-no-goals-idle-' + viewport.width + '.png') });

      const painted = new Set();
      const firstSave = await paintAndWaitForSave(page, coloringId, painted);
      await expect(page.locator('.save-status')).toBeVisible();
      await expect(page.locator('.save-status')).toContainText(/Сохранено|Синхронизация|Ожидает отправки|Сохранено локально/);
      await assertNoSessionGoalSurface(page);
      const paintedMetrics = await collectMetrics(page);
      await page.screenshot({ path: resolve(evidenceDir, 'player-no-goals-painted-' + viewport.width + '.png') });

      // Reload the same deep link to prove server-backed persistence and that
      // reopening does not recreate retired local session-goal state.
      await page.reload();
      await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
      await assertNoSessionGoalSurface(page);
      await expect(page.locator('.coloring-canvas')).toBeVisible();
      await expect(page.locator('.save-status')).toBeVisible();
      const persistedResponse = await page.request.get('/api/colorings/' + coloringId + '/progress');
      expect(persistedResponse.ok()).toBe(true);
      const persisted = await persistedResponse.json();
      expect(Number(persisted.revision)).toBeGreaterThanOrEqual(Number(firstSave.revision));
      expect(persisted.filled).toEqual(firstSave.filled);
      const reopenedMetrics = await collectMetrics(page);

      // Finish the 8x8 fixture through the same server-authoritative path used
      // by the completion coverage, without reviving a goal celebration or XP.
      const templateResponse = await page.request.get('/api/colorings/' + coloringId);
      expect(templateResponse.ok()).toBe(true);
      const template = await templateResponse.json();
      const completionChanges = persisted.filled
        .map((value, index) => Number(value) === -1 ? { index, color: template.cells[index] } : null)
        .filter(Boolean);
      const completed = await applyProgressChanges(
        page,
        coloringId,
        completionChanges,
        persisted.revision,
        completionPreview,
        'session-goals-evidence-completion-' + viewport.width,
      );
      expect(Number(completed.percent)).toBe(100);
      expect(completed.completed_at).toBeTruthy();
      await page.reload();
      await expect(page.locator('.player-page')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.completion-overlay')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.completion-overlay')).not.toContainText(/\bXP\b|уровень|серия/i);
      await assertNoSessionGoalSurface(page);
      const completionMetrics = await collectMetrics(page);
      await page.screenshot({ path: resolve(evidenceDir, 'player-no-goals-complete-' + viewport.width + '.png') });

      captured.push({
        viewport,
        idle: idleMetrics,
        painted: paintedMetrics,
        reopened: reopenedMetrics,
        completed: completionMetrics,
      });
    });
  }
});
