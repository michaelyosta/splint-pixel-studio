import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Delivery verifier: a real 1200x1200 tiled treatment session must receive
 * INITIAL_TARGET, expose a visible Spark, claim that Spark through the real
 * canvas pointer/stroke flow, present the Spark HUD, apply one bounded
 * effect, and continue to a second guidance target.
 *
 * The fixture is deterministic and created through the same public API used
 * by the app. Spark placement, claim, and effect derivation are all
 * server-side; this spec only drives the UI and reads metadata endpoints.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const evidenceDir = resolve(projectRoot, 'docs', 'evidence', 'special-cells-1200-delivery-2026-08-09');

const GRID = 1200;
const TILE = 32;
const TILES_PER_AXIS = Math.ceil(GRID / TILE);
const PALETTE = ['#101820', '#ffffff', '#ff6b6b', '#2bd9fe'];

async function dismissOnboarding(page) {
  const skip = page.locator('.onboarding-card .secondary-button');
  await skip.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await skip.isVisible().catch(() => false)) await skip.click({ force: true });
}

async function createCohort1200(page, cohort) {
  const userId = `e2e_special_1200_${cohort}`;
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': userId });
  const fixtureResponse = await page.request.post('/api/__e2e/seed-cohort-template', {
    data: {
      cohort,
      storage: 'tiled',
      size: { width: GRID, height: GRID },
    },
    timeout: 120000,
  });
  expect(fixtureResponse.ok()).toBe(true);
  const fixture = await fixtureResponse.json();
  expect(fixture.cohort).toBe(cohort);
  expect(fixture.storage).toBe('tiled');
  expect(fixture.size).toEqual({ width: GRID, height: GRID });
  const progressResponse = await page.request.get(`/api/colorings/${fixture.id}/progress`);
  expect(progressResponse.ok()).toBe(true);
  const progress = await progressResponse.json();
  expect(progress.specials_experiment_group).toBe(cohort);
  return {
    created: { id: fixture.id },
    progress,
    fixture,
  };
}

async function waitForTiledReady(page) {
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toHaveAttribute('data-special-treatment', 'treatment', { timeout: 30000 });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const state = await session.getAttribute('data-smart-state').catch(() => null);
    if (state === 'ready') break;
    if (state === 'errorRetryable') {
      const retry = page.locator('.progressive-grid-error button').last();
      if (await retry.isVisible().catch(() => false)) await retry.click();
    }
    await page.waitForTimeout(1500);
  }
  await expect(session).toHaveAttribute('data-smart-state', 'ready', { timeout: 30000 });
  await expect(session).toHaveAttribute('data-lod-mode', 'work', { timeout: 15000 });
  await expect(page.locator('.progressive-grid-guide')).toBeVisible();
  await page.waitForTimeout(500);
}

async function readCamera(page) {
  const area = page.locator('.progressive-grid-area');
  return {
    x: Number(await area.getAttribute('data-camera-x')),
    y: Number(await area.getAttribute('data-camera-y')),
    zoom: Number(await area.getAttribute('data-camera-zoom')),
  };
}

function cellToScreen(cellX, cellY, cam, box) {
  return {
    x: box.x + cellX * TILE * cam.zoom + cam.x,
    y: box.y + cellY * TILE * cam.zoom + cam.y,
  };
}

async function readSessionState(page) {
  const session = page.locator('.progressive-coloring-session');
  return {
    smartState: await session.getAttribute('data-smart-state'),
    lodMode: await session.getAttribute('data-lod-mode'),
    color: await session.getAttribute('data-smart-color'),
    targetTile: await session.getAttribute('data-smart-target-tile'),
    targetX: await session.getAttribute('data-smart-target-x'),
    targetY: await session.getAttribute('data-smart-target-y'),
    minX: await session.getAttribute('data-smart-target-min-x'),
    minY: await session.getAttribute('data-smart-target-min-y'),
    maxX: await session.getAttribute('data-smart-target-max-x'),
    maxY: await session.getAttribute('data-smart-target-max-y'),
  };
}

async function fetchTile(page, id, tileX, tileY) {
  const response = await page.request.get(`/api/colorings/${id}/tiles/${tileX}/${tileY}`);
  expect(response.ok()).toBe(true);
  return response.json();
}

async function findVisibleSpark(page, id, targetTile, specialId) {
  const [tileX, tileY] = String(targetTile).split(':').map(Number);
  const targetTilePayload = await fetchTile(page, id, tileX, tileY);
  const exactTargetSpecial = (targetTilePayload.specials || []).find((candidate) => (
    candidate.kind === 'spark'
    && candidate.state === 'unseen'
    && candidate.id === specialId
  ));
  if (exactTargetSpecial) {
      return {
        special: exactTargetSpecial,
        tile: targetTilePayload,
        tileX,
        tileY,
        x: Number(exactTargetSpecial.cell_index) % GRID,
        y: Math.floor(Number(exactTargetSpecial.cell_index) / GRID),
      };
  }
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const tx = tileX + dx;
      const ty = tileY + dy;
      if (tx < 0 || ty < 0 || tx >= TILES_PER_AXIS || ty >= TILES_PER_AXIS) continue;
      const tile = await fetchTile(page, id, tx, ty);
      const special = (tile.specials || []).find((candidate) => (
        candidate.kind === 'spark'
        && candidate.state === 'unseen'
        && candidate.id === specialId
      ));
      if (special) {
        return {
          special,
          tile,
          tileX: tx,
          tileY: ty,
          x: Number(special.cell_index) % GRID,
          y: Math.floor(Number(special.cell_index) / GRID),
        };
      }
    }
  }
  return null;
}

async function assertDiagnostics(page, { cohort, expectVisible = true } = {}) {
  const diagnostics = page.locator('[data-special-diagnostics]');
  if (!expectVisible) {
    await expect(diagnostics).toHaveCount(0);
    return;
  }
  await expect(diagnostics).toBeVisible({ timeout: 15000 });
  await expect(diagnostics).toHaveAttribute('data-special-diagnostics-cohort', cohort);
  await expect(diagnostics).toHaveAttribute('data-special-diagnostics-counts', /u\d+ o\d+ c\d+ s\d+/);
  await expect(diagnostics).toHaveAttribute('data-special-diagnostics-target', /c\d+ \d+cells/);
  await expect(diagnostics).toHaveAttribute('data-special-diagnostics-expanded', 'false');
  const compactText = await diagnostics.innerText();
  expect(compactText).toContain(cohort.toUpperCase());
  expect(compactText).not.toMatch(/special[_ -]?id|offer[_ -]?token|cell[_ -]?index|tile[_ -]?[xy]|local[_ -]?index/i);

  await diagnostics.locator('[data-special-diagnostics-toggle]').click();
  await expect(diagnostics).toHaveAttribute('data-special-diagnostics-expanded', 'true');
  const expandedText = await diagnostics.innerText();
  expect(expandedText).toContain('cohort:');
  expect(expandedText).toContain('counts:');
  expect(expandedText).toContain('target:');
  expect(expandedText).not.toMatch(/special[_ -]?id|offer[_ -]?token|cell[_ -]?index|tile[_ -]?[xy]|local[_ -]?index/i);
  expect(expandedText).not.toMatch(/sc_[a-f0-9]+/i);
}

async function waitForSettledBottomSheet(page) {
  await expect.poll(async () => page.evaluate(() => {
    const isPainted = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    const sheets = [...document.querySelectorAll('.bottom-sheet')];
    const overlays = [...document.querySelectorAll('.bottom-sheet-overlay')];
    const hiddenFocusable = sheets
      .filter((sheet) => !isPainted(sheet))
      .flatMap((sheet) => [...sheet.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')])
      .filter((element) => !element.disabled)
      .length;
    const activeAnimations = [...overlays, ...sheets]
      .flatMap((element) => element.getAnimations())
      .filter((animation) => animation.playState !== 'finished').length;
    return {
      overlayCount: overlays.length,
      sheetCount: sheets.length,
      visibleSheetCount: sheets.filter(isPainted).length,
      hiddenFocusable,
      activeAnimations,
    };
  }), { timeout: 5000 }).toEqual({
    overlayCount: 1,
    sheetCount: 1,
    visibleSheetCount: 1,
    hiddenFocusable: 0,
    activeAnimations: 0,
  });
}

async function dismissSpecialHintIfVisible(page) {
  const hint = page.locator('[data-special-help-hint]');
  if (await hint.isVisible().catch(() => false)) {
    await hint.locator('.special-help-hint-close').click();
    await expect(hint).toHaveCount(0);
  }
}

async function settleCollapsedSpecialDiagnostics(page) {
  const diagnostics = page.locator('[data-special-diagnostics]');
  await expect(diagnostics).toBeVisible();
  if (await diagnostics.getAttribute('data-special-diagnostics-expanded') === 'true') {
    await diagnostics.locator('[data-special-diagnostics-toggle]').click();
  }
  await expect(diagnostics).toHaveAttribute('data-special-diagnostics-expanded', 'false');
  await expect(diagnostics.locator('[data-special-diagnostics-copy]')).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => {
    const root = document.querySelector('[data-special-diagnostics]');
    if (!root) return false;
    const expandedRoots = document.querySelectorAll('[data-special-diagnostics-expanded="true"]');
    const activeAnimations = [...root.getAnimations()]
      .filter((animation) => animation.playState !== 'finished').length;
    return root.getAttribute('data-special-diagnostics-expanded') === 'false'
      && !root.querySelector('[data-special-diagnostics-copy]')
      && expandedRoots.length === 0
      && activeAnimations === 0;
  }), { timeout: 5000 }).toBe(true);
  await page.evaluate(() => new Promise((resolveFrame) => {
    requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
  }));
}

function sameColorRun(tile, spark) {
  const width = Number(tile.tile?.width || tile.width);
  const cells = tile.cells || [];
  if (!cells.length) {
    throw new Error(`Spark tile ${spark.tileX}:${spark.tileY} payload has no cells`);
  }
  const localX = spark.x % TILE;
  const localY = spark.y % TILE;
  const color = Number(cells[localY * width + localX]);
  let start = localX;
  while (start > 0 && Number(cells[localY * width + start - 1]) === color) start -= 1;
  let end = localX;
  while (end < width - 1 && Number(cells[localY * width + end + 1]) === color) end += 1;
  return {
    color,
    startX: Math.max(spark.x - 3, spark.x - (localX - start)),
    endX: Math.min(spark.x + 3, spark.x + (end - localX)),
  };
}

async function ensureSparkVisible(page, spark, box) {
  await page.waitForResponse(
    (response) => response.url().includes(`/tiles/${spark.tileX}/${spark.tileY}`) && response.ok(),
    { timeout: 10000 },
  ).catch(() => {});
  await expect.poll(async () => page.evaluate(({ x, y }) => {
    const cell = window.__splintClient?.getCell(x, y);
    return Boolean(cell?.loaded);
  }, { x: spark.x, y: spark.y }), { timeout: 15000 }).toBe(true);
  await page.waitForTimeout(300);
  await expect.poll(async () => {
    const cam = await readCamera(page);
    const point = cellToScreen(spark.x, spark.y, cam, box);
    return point.x >= box.x && point.x <= box.x + box.width
      && point.y >= box.y && point.y <= box.y + box.height;
  }, { timeout: 10000 }).toBe(true);
  return readCamera(page);
}

async function dragTouchStroke(page, touchSession, points) {
  const [start, ...moves] = points;
  await touchSession.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: start.x, y: start.y }],
  });
  for (const point of moves) {
    await touchSession.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x, y: point.y }],
    });
    await page.waitForTimeout(45);
  }
}

async function endTouchStroke(page, touchSession) {
  await touchSession.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

const clientStats = (page) => page.evaluate(() => ({
  cache: window.__splintClient?.getMemoryStats?.() || null,
  network: window.__splintClient?.getNetworkStats?.() || null,
  snapshot: window.__splintClient?.getSnapshot?.() || null,
}));

test('1200 treatment delivers INITIAL_TARGET, paints visible Spark on canvas, uses bounded effect, continues', async ({ page, browserName }, testInfo) => {
  test.skip(browserName === 'webkit', '1200 delivery verifier targets the chromium contract');
  test.setTimeout(240000);
  mkdirSync(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });
  await page.route('https://telegram.org/js/telegram-web-app.js', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: 'window.Telegram = window.Telegram || { WebApp: { ready() {} } };',
    });
  });

  const guidance = [];
  const tileRequests = [];
  const actionRequests = [];
  await page.on('response', async (response) => {
    if (!response.url().includes('/guidance')) return;
    try { guidance.push(await response.json()); } catch {}
  });
  await page.on('request', (request) => {
    if (/\/tiles\/\d+\/\d+$/.test(request.url())) tileRequests.push(request.url());
    if (request.url().includes('/progress/actions') && request.method() === 'POST') {
      try {
        actionRequests.push(request.postDataJSON());
      } catch {
        actionRequests.push(null);
      }
    }
  });

  const { created, progress, fixture } = await createCohort1200(page, 'treatment');
  const id = created.id;
  await page.goto(`/?coloring=${id}&splintMetrics=1&specialDiagnostics=1`);
  await page.locator('.progressive-coloring-session').first().waitFor({ state: 'visible', timeout: 30000 });
  await dismissOnboarding(page);
  await waitForTiledReady(page);

  const firstTarget = await readSessionState(page);
  expect(firstTarget.smartState).toBe('ready');
  expect(firstTarget.lodMode).toBe('work');
  expect(firstTarget.targetTile).toMatch(/^\d+:\d+$/);
  expect(firstTarget.targetX).toMatch(/^-?\d+$/);
  const initialGuidance = guidance.find((plan) => plan.reason === 'INITIAL_TARGET');
  expect(initialGuidance, 'session must receive INITIAL_TARGET').toBeTruthy();
  expect(initialGuidance.target?.estimated_cells).toBeGreaterThan(0);
  expect(initialGuidance.special_id, 'INITIAL_TARGET must identify the early Spark').toBeTruthy();
  await expect(page.locator('[data-lod-mode="work"]')).toHaveCount(1);
  await expect(page.locator('.progressive-grid-guide')).toBeVisible();
  await expect(page.locator('.progressive-coloring-session')).toHaveAttribute('data-lod-mode', 'work');

  const readyStats = await clientStats(page);
  const readyTileRequests = tileRequests.length;
  expect(readyTileRequests).toBeLessThanOrEqual(48);
  expect(readyStats.cache?.tiles ?? 0).toBeLessThanOrEqual(48);
  expect(readyStats.network?.peakConcurrentTileRequests ?? 0).toBeLessThanOrEqual(48);
  await assertDiagnostics(page, { cohort: 'treatment' });
  await page.locator('[data-special-diagnostics-toggle]').click();
  await expect(page.locator('[data-special-diagnostics-expanded="false"]')).toBeVisible();
  await page.screenshot({ path: resolve(evidenceDir, '00-390-diagnostics-collapsed.png'), fullPage: false });
  await page.locator('[data-special-diagnostics-toggle]').click();
  await expect(page.locator('[data-special-diagnostics-expanded="true"]')).toBeVisible();
  await page.screenshot({ path: resolve(evidenceDir, '00-390-diagnostics-expanded.png'), fullPage: false });
  // The expanded dump is diagnostic evidence only. Collapse it before any
  // screenshot intended to prove the visible WORK-LOD marker on the Canvas.
  await settleCollapsedSpecialDiagnostics(page);
  await page.screenshot({ path: resolve(evidenceDir, '01-initial-target.png'), fullPage: false });

  const found = await findVisibleSpark(page, id, firstTarget.targetTile, initialGuidance.special_id);
  expect(found, 'INITIAL_TARGET must expose exactly the guidance Spark').toBeTruthy();
  const spark = found;
  expect(spark.special.id).toBe(initialGuidance.special_id);
  expect(spark.x).toBeGreaterThanOrEqual(initialGuidance.target.bounds.min_x);
  expect(spark.x).toBeLessThanOrEqual(initialGuidance.target.bounds.max_x);
  expect(spark.y).toBeGreaterThanOrEqual(initialGuidance.target.bounds.min_y);
  expect(spark.y).toBeLessThanOrEqual(initialGuidance.target.bounds.max_y);
  const selectedColor = Number(firstTarget.color);
  expect(selectedColor).toBeGreaterThanOrEqual(0);

  const viewportBox = await page.locator('.progressive-grid-area').boundingBox();
  expect(viewportBox).toBeTruthy();
  const cam = await ensureSparkVisible(page, spark, viewportBox);
  const screenSpark = cellToScreen(spark.x, spark.y, cam, viewportBox);
  expect(screenSpark.x).toBeGreaterThanOrEqual(viewportBox.x);
  expect(screenSpark.x).toBeLessThanOrEqual(viewportBox.x + viewportBox.width);
  expect(screenSpark.y).toBeGreaterThanOrEqual(viewportBox.y);
  expect(screenSpark.y).toBeLessThanOrEqual(viewportBox.y + viewportBox.height);
  await dismissSpecialHintIfVisible(page);
  await settleCollapsedSpecialDiagnostics(page);
  await page.screenshot({ path: resolve(evidenceDir, '02-spark-visible.png'), fullPage: false });

  const run = sameColorRun(spark.tile, spark);
  expect(run.color).toBe(selectedColor);
  expect(spark.special.kind).toBe('spark');
  expect(fixture.specials_experiment_group).toBe('treatment');

  const firstTargetSnapshot = {
    smartState: firstTarget.smartState,
    lodMode: firstTarget.lodMode,
    color: firstTarget.color,
    targetTile: firstTarget.targetTile,
    targetX: firstTarget.targetX,
    targetY: firstTarget.targetY,
    minX: firstTarget.minX,
    minY: firstTarget.minY,
    maxX: firstTarget.maxX,
    maxY: firstTarget.maxY,
    specialId: spark.special.id,
  };
  const guidanceCountBeforeReload = guidance.length;
  await page.reload();
  await page.locator('.progressive-coloring-session').first().waitFor({ state: 'visible', timeout: 30000 });
  await waitForTiledReady(page);
  const reloadedTarget = await readSessionState(page);
  expect({
    smartState: reloadedTarget.smartState,
    lodMode: reloadedTarget.lodMode,
    color: reloadedTarget.color,
    targetTile: reloadedTarget.targetTile,
    targetX: reloadedTarget.targetX,
    targetY: reloadedTarget.targetY,
    minX: reloadedTarget.minX,
    minY: reloadedTarget.minY,
    maxX: reloadedTarget.maxX,
    maxY: reloadedTarget.maxY,
  }).toEqual({
    smartState: firstTargetSnapshot.smartState,
    lodMode: firstTargetSnapshot.lodMode,
    color: firstTargetSnapshot.color,
    targetTile: firstTargetSnapshot.targetTile,
    targetX: firstTargetSnapshot.targetX,
    targetY: firstTargetSnapshot.targetY,
    minX: firstTargetSnapshot.minX,
    minY: firstTargetSnapshot.minY,
    maxX: firstTargetSnapshot.maxX,
    maxY: firstTargetSnapshot.maxY,
  });
  const reloadedInitialGuidance = guidance
    .slice(guidanceCountBeforeReload)
    .find((plan) => plan.reason === 'INITIAL_TARGET' && plan.special_id === firstTargetSnapshot.specialId);
  expect(reloadedInitialGuidance, 'reload must reconstruct the same INITIAL_TARGET Spark').toBeTruthy();
  await expect(page.locator('.progressive-grid-guide')).toBeVisible();
  await page.screenshot({ path: resolve(evidenceDir, '02-reload-deterministic.png'), fullPage: false });

  const reloadedViewportBox = await page.locator('.progressive-grid-area').boundingBox();
  expect(reloadedViewportBox).toBeTruthy();
  const reloadedCam = await ensureSparkVisible(page, spark, reloadedViewportBox);
  const touchSession = await page.context().newCDPSession(page);
  await touchSession.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const start = cellToScreen(spark.x, spark.y, reloadedCam, reloadedViewportBox);
  // Keep the Gate Zero gesture scoped to the guidance Spark itself. A longer
  // drag can legitimately cross another special candidate in the same 12x12
  // window; the server then correctly claims the first special in the
  // submitted change set, which would make this verifier ambiguous.
  const end = { x: start.x + 1, y: start.y };

  const claimResponsePromise = page.waitForResponse((response) => {
    if (!response.url().includes(`/colorings/${id}/progress/actions`)
      || response.request().method() !== 'POST') return false;
    try {
      return response.request().postDataJSON()?.special_action?.type === 'claim_spark';
    } catch {
      return false;
    }
  }, { timeout: 30000 });
  const points = [{ x: start.x, y: start.y }];
  const steps = 2;
  for (let index = 1; index <= steps; index += 1) {
    points.push({ x: start.x + ((end.x - start.x) * index) / steps, y: start.y });
  }
  await dragTouchStroke(page, touchSession, points);
  await endTouchStroke(page, touchSession);
  await page.waitForTimeout(300);

  const claimResponse = await claimResponsePromise;
  expect(actionRequests.some((body) => body?.special_action?.type === 'claim_spark')).toBe(true);
  expect(claimResponse.status()).toBe(200);
  const claimed = await claimResponse.json();
  expect(claimed.special_discovered).toEqual({ special_id: spark.special.id, kind: 'spark' });
  expect(claimed.special_offer?.target_options).toHaveLength(2);
  expect(claimed.special_offer?.special_id).toBe(spark.special.id);
  const selectedSparkTarget = claimed.special_offer.target_options[0];

  await expect(page.locator('.progressive-grid-special-offer')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.progressive-grid-special-offer')).toHaveAttribute('data-special-kind', 'spark');
  await expect(page.locator('.progressive-grid-special-offer')).toHaveAttribute('data-special-supported', 'true');
  await expect(page.locator('[data-special-option="a"]')).toBeVisible();
  const paintedOnCanvas = await page.evaluate(({ x, y, color }) => {
    const cell = window.__splintClient?.getCell(x, y);
    return Boolean(cell && cell.filled === color);
  }, { x: spark.x, y: spark.y, color: selectedColor });
  expect(paintedOnCanvas, 'Spark cell must be painted through the canvas stroke').toBe(true);
  const strokeMetrics = await page.evaluate(() => window.__splintStrokeMetrics || null);
  expect(strokeMetrics?.strokes?.length).toBeGreaterThanOrEqual(1);
  expect(strokeMetrics.strokes.at(-1).painted).toBeGreaterThanOrEqual(1);
  await page.screenshot({ path: resolve(evidenceDir, '03-spark-claim-offer.png'), fullPage: false });

  const useResponsePromise = page.waitForResponse((response) => {
    if (!response.url().includes(`/colorings/${id}/progress/actions`)
      || response.request().method() !== 'POST') return false;
    try {
      return response.request().postDataJSON()?.special_action?.type === 'use_spark';
    } catch {
      return false;
    }
  });
  await page.locator('[data-special-option="a"]').click();
  const useResponse = await useResponsePromise;
  expect(useResponse.status()).toBe(200);
  const used = await useResponse.json();
  expect(used.special_applied_changes.length).toBe(selectedSparkTarget.estimated_cells);
  expect(used.special_applied_changes.length).toBeLessThanOrEqual(144);
  await expect(page.locator('.progressive-grid-special-offer')).toHaveCount(0, { timeout: 15000 });
  const guidanceCountBeforeNext = guidance.length;

  const effectCellsVisible = await page.evaluate(({ changes, width }) => {
    return changes.every((change) => {
      const x = Number(change.index) % width;
      const y = Math.floor(Number(change.index) / width);
      const cell = window.__splintClient?.getCell(x, y);
      return Boolean(cell && cell.filled === Number(change.color));
    });
  }, { changes: used.special_applied_changes, width: GRID });
  expect(effectCellsVisible, 'applied Spark effect must be reflected on the local canvas state').toBe(true);
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(evidenceDir, '04-effect-applied.png'), fullPage: false });

  await expect.poll(async () => guidance.length > guidanceCountBeforeNext, { timeout: 20000 }).toBe(true);
  const nextPlan = guidance[guidance.length - 1];
  expect(nextPlan.reason).toBe('SAME_COLOR_NEXT');
  expect(nextPlan.target?.estimated_cells).toBeGreaterThan(0);
  await expect(page.locator('.progressive-coloring-session')).toHaveAttribute('data-smart-state', 'ready', { timeout: 15000 });
  const secondTarget = await readSessionState(page);
  expect(secondTarget.smartState).toBe('ready');
  expect(secondTarget.targetTile).toMatch(/^\d+:\d+$/);
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(evidenceDir, '05-second-target.png'), fullPage: false });

  const finalStats = await clientStats(page);
  expect(finalStats.cache?.tiles ?? 0).toBeLessThanOrEqual(48);
  expect(finalStats.network?.peakConcurrentTileRequests ?? 0).toBeLessThanOrEqual(48);

  writeFileSync(resolve(evidenceDir, `${testInfo.project.name}-metrics.json`), JSON.stringify({
    capturedAt: new Date().toISOString(),
    project: testInfo.project.name,
    viewport: page.viewportSize(),
    grid: { width: GRID, height: GRID, tileSize: TILE, palette: PALETTE },
    fixture: { template_id: id, total_cells: progress.total_cells },
    initial_target: {
      reason: initialGuidance.reason,
      target: initialGuidance.target,
      session: firstTarget,
    },
    spark: {
      id: spark.special.id,
      kind: spark.special.kind,
      cell_index: Number(spark.special.cell_index),
      x: spark.x,
      y: spark.y,
      tile_x: spark.tileX,
      tile_y: spark.tileY,
      stroke_run: run,
    },
    claim: {
      revision: claimed.revision,
      special_discovered: claimed.special_discovered,
      offer_kind: 'spark',
      offer_options: claimed.special_offer?.target_options?.map((option) => ({
        option_id: option.option_id,
        color: option.color,
        estimated_cells: option.estimated_cells,
        bounds: option.bounds,
      })),
      stroke_metrics: strokeMetrics,
    },
    effect: {
      revision: used.revision,
      change_count: used.special_applied_changes.length,
      cap: 144,
      first_change: used.special_applied_changes[0],
    },
    second_target: {
      reason: nextPlan.reason,
      target: nextPlan.target,
      session: secondTarget,
    },
    tile_loading: {
      ready_request_count: readyTileRequests,
      final_request_count: tileRequests.length,
      ready_client: readyStats,
      final_client: finalStats,
    },
    guidance_plan_count: guidance.length,
  }, null, 2));
});

test('1200 control has no special markers, tutorial, help, or special HUD', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', '1200 control verifier targets the chromium contract');
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    try { localStorage.removeItem('splint_onboarding_version'); } catch {}
  });
  await page.route('https://telegram.org/js/telegram-web-app.js', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: 'window.Telegram = window.Telegram || { WebApp: { ready() {} } };',
    });
  });

  const { created, progress } = await createCohort1200(page, 'control');
  expect(progress.specials || []).toEqual([]);
  await page.goto(`/?coloring=${created.id}`);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toBeVisible({ timeout: 30000 });
  await dismissOnboarding(page);
  await expect(session).toHaveAttribute('data-special-treatment', 'control', { timeout: 30000 });
  await expect(session).toHaveAttribute('data-lod-mode', 'work', { timeout: 30000 });
  await expect(page.locator('.progressive-grid-special-offer')).toHaveCount(0);
  await expect(page.locator('[data-special-discovered]')).toHaveCount(0);
  await expect(page.locator('[data-special-help-intro]')).toHaveCount(0);
  await expect(page.locator('[data-special-help-hint]')).toHaveCount(0);
  await expect(page.locator('[data-special-diagnostics]')).toHaveCount(0);
  await page.locator('.player-menu-btn').click();
  await expect(page.locator('.bottom-sheet')).toBeVisible();
  await expect(page.locator('.bottom-sheet-actions button').filter({ hasText: 'Особые клетки' })).toHaveCount(0);
  await waitForSettledBottomSheet(page);
  await page.screenshot({ path: resolve(evidenceDir, '06-control-390-menu.png'), fullPage: false });
  await page.keyboard.press('Escape');
  await expect(page.locator('.bottom-sheet')).toHaveCount(0);
  await expect(page.locator('[data-special-diagnostics]')).toHaveCount(0);
  await page.screenshot({ path: resolve(evidenceDir, '06-control-390-clean.png'), fullPage: false });
});
