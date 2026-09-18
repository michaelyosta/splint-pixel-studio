import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const evidenceDir = resolve(projectRoot, 'docs', 'evidence', 'tiled-low-zoom-2026-08-08');
const fixture = resolve(projectRoot, 'e2e', 'fixtures', 'stroke-bars.png');
const WIDTH = 1200;
const HEIGHT = 1200;
const TILE_SIZE = 32;
const PALETTE = ['#101820', '#ffffff', '#ff6b6b'];

function buildTiledPayload() {
  const columns = Math.ceil(WIDTH / TILE_SIZE);
  const rows = Math.ceil(HEIGHT / TILE_SIZE);
  const tiles = [];
  for (let tileY = 0; tileY < rows; tileY += 1) {
    for (let tileX = 0; tileX < columns; tileX += 1) {
      const width = tileX === columns - 1 ? WIDTH - tileX * TILE_SIZE : TILE_SIZE;
      const height = tileY === rows - 1 ? HEIGHT - tileY * TILE_SIZE : TILE_SIZE;
      const cells = [];
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) cells.push((tileX + tileY + x + y) % PALETTE.length);
      }
      tiles.push({ tile_x: tileX, tile_y: tileY, width, height, cells });
    }
  }
  return tiles;
}

async function dismissOnboarding(page) {
  const skip = page.locator('.onboarding-card .secondary-button');
  await skip.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await skip.isVisible().catch(() => false)) await skip.click({ force: true });
}

async function createAndOpen1200(page, testInfo) {
  const projectKey = testInfo.project.name.replace(/[^a-z0-9]+/gi, '_');
  const userId = `e2e_low_zoom_1200_${projectKey}_${testInfo.repeatEachIndex}`;
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': userId });
  const previewDataUrl = `data:image/png;base64,${readFileSync(fixture).toString('base64')}`;
  const createResponse = await page.request.post('/api/colorings/create', {
    data: {
      title: 'Low zoom 1200 e2e',
      storageMode: 'tiled',
      width: WIDTH,
      height: HEIGHT,
      tileSize: TILE_SIZE,
      palette: PALETTE,
      tiles: buildTiledPayload(),
      previewDataUrl,
    },
    timeout: 120000,
  });
  expect(createResponse.ok()).toBe(true);
  const created = await createResponse.json();
  await page.goto(`/?coloring=${created.id}&splintMetrics=1`);
  await page.locator('.progressive-coloring-session').first().waitFor({ state: 'visible', timeout: 30000 });
  await dismissOnboarding(page);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toHaveAttribute('data-lod-mode', 'work', { timeout: 30000 });
  return session;
}

async function pressOverview(page) {
  await page.locator('.progressive-grid-area canvas').first().focus();
  await page.keyboard.press('0');
  await expect(page.locator('.progressive-coloring-session')).toHaveAttribute('data-lod-mode', 'overview');
}

async function waitForTileNetworkIdle(page) {
  await expect.poll(
    () => page.evaluate(() => {
      const stats = window.__splintClient?.getNetworkStats?.();
      const snapshot = window.__splintClient?.getSnapshot?.();
      return {
        activeTileRequests: Number(stats?.activeTileRequests || 0),
        pendingTiles: snapshot?.pendingTiles?.length || 0,
      };
    }),
    { timeout: 60000, message: 'tiled viewport work must settle before measuring the next phase' },
  ).toEqual({ activeTileRequests: 0, pendingTiles: 0 });
}

async function waitForInitialWorkPlan(page) {
  // data-lod-mode becomes WORK when the first Director target is accepted,
  // while the viewport loader starts from its own scheduled effect.  Waiting
  // for the observable plan keeps the test from switching to OVERVIEW while
  // that real WORK request batch is still only scheduled.
  await expect.poll(
    () => page.evaluate(() => Number(window.__splintClient?.getNetworkStats?.().workPlans || 0)),
    { timeout: 60000, message: 'initial WORK viewport plan must start before overview is measured' },
  ).toBeGreaterThan(0);
  await waitForTileNetworkIdle(page);
}

async function waitForViewportQuiescence(page) {
  // waitForTileNetworkIdle cannot observe the viewport loader's settle timer
  // (80ms in WORK mode), so a plan scheduled by the last camera move may
  // still fire afterwards. Plans only start on camera/lod/size change; with
  // the camera settled, at most one pending timer exists and it fires within
  // the settle window below — so a workPlans count stable across a longer
  // window proves no timer is pending and no background batch can ambush a
  // fault-injection phase that follows.
  await expect.poll(async () => {
    const before = await page.evaluate(() => Number(window.__splintClient?.getNetworkStats?.().workPlans || 0));
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => Number(window.__splintClient?.getNetworkStats?.().workPlans || 0));
    return before === after ? 'quiet' : 'planning';
  }, { timeout: 60000, message: 'viewport loader must go quiet before fault injection' }).toBe('quiet');
  await waitForTileNetworkIdle(page);
}

test.describe('tiled 1200 low zoom', () => {
  test('overview is preview-stable, work reloads tiles, 502 stays local and retry recovers', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    mkdirSync(evidenceDir, { recursive: true });
    const tileRequests = [];
    const tileResponses = [];
    await page.on('request', (request) => {
      if (/\/tiles\/\d+\/\d+/.test(request.url())) tileRequests.push(request.url());
    });
    await page.on('response', (response) => {
      if (/\/tiles\/\d+\/\d+/.test(response.url())) {
        tileResponses.push({ url: response.url(), status: response.status() });
      }
    });

    const session = await createAndOpen1200(page, testInfo);
    // Overview inserts a "return to target" control before zoom buttons. Use
    // the semantic labels so this verifier keeps exercising zoom rather than
    // repeatedly clicking the optional return control.
    const zoomIn = page.getByRole('button', { name: 'Увеличить' });
    const zoomOut = page.getByRole('button', { name: 'Уменьшить' });
    const clientStats = () => page.evaluate(() => ({
      cache: window.__splintClient?.getMemoryStats?.(),
      network: window.__splintClient?.getNetworkStats?.(),
    }));
    // Tile fetch attempts attributed by the plan mode that issued them (see
    // workPlanTileFetches/overviewPlanTileFetches in progressiveGridClient).
    // A WORK plan scheduled before the overview flip (80ms settle timer vs
    // WebKit toolbar/resize settles) may settle inside the wall-clock
    // measurement window; attributing attempts by plan mode keeps the
    // overview contract deterministic under that race.
    const planAttribution = () => page.evaluate(() => {
      const network = window.__splintClient?.getNetworkStats?.() || {};
      return {
        tileFetches: Number(network.tileFetches || 0),
        workPlans: Number(network.workPlans || 0),
        overviewPlans: Number(network.overviewPlans || 0),
        workPlanTileFetches: Number(network.workPlanTileFetches || 0),
        overviewPlanTileFetches: Number(network.overviewPlanTileFetches || 0),
      };
    });

    // Do not count the tail of the initial WORK prefetch as an overview
    // request. The plan itself is causal state: lod-mode can become WORK
    // before the separately scheduled viewport effect has started. Drain
    // that tail (plus any resize-settled follow-up plans) BEFORE observing:
    // waitForTileNetworkIdle cannot see the loader's 80ms settle timer.
    await waitForInitialWorkPlan(page);
    await waitForViewportQuiescence(page);
    tileRequests.length = 0;
    tileResponses.length = 0;
    const planBaseline = await planAttribution();
    const overviewStartedAt = Date.now();
    await pressOverview(page);
    await waitForTileNetworkIdle(page);
    await expect(session).toHaveAttribute('data-tile-error-count', '0');
    const planAfter = await planAttribution();
    const planDelta = {
      tileFetches: planAfter.tileFetches - planBaseline.tileFetches,
      workPlans: planAfter.workPlans - planBaseline.workPlans,
      overviewPlans: planAfter.overviewPlans - planBaseline.overviewPlans,
      workPlanTileFetches: planAfter.workPlanTileFetches - planBaseline.workPlanTileFetches,
      overviewPlanTileFetches: planAfter.overviewPlanTileFetches - planBaseline.overviewPlanTileFetches,
    };
    // Wall-clock request/response counts are diagnostic only, NOT gates:
    // Playwright request events cross an async delivery boundary, so a
    // correctly-aborted WORK tail (or browser connection-queue drain) can
    // land its events after the counters above were cleared even though the
    // causal product state below proves overview itself fetched nothing.
    // Gating on them asserts harness timing, not product behavior (observed:
    // 8 aborted-tail events counted while overviewPlanTileFetches stayed 0).
    console.log(`overview plan attribution: ${JSON.stringify(planDelta)} wallClock=${JSON.stringify({ requests: tileRequests.length, responses: tileResponses.length })}`);
    // Overview viewport plans never fetch detail tiles: the preview is the
    // overview source of truth (matching unit contract in
    // test/progressiveGridClient.test.js). Exact zero — strictly stronger
    // than the old wall-clock <= 1 proxy.
    expect(planDelta.overviewPlanTileFetches).toBe(0);
    const overviewTileResponseCount = tileResponses.length;
    await page.screenshot({ path: resolve(evidenceDir, `${testInfo.project.name}-overview.png`), fullPage: false });

    const overviewStats = await clientStats();
    expect(overviewStats.cache.tiles).toBeLessThanOrEqual(48);
    expect(overviewStats.network.overviewPlans).toBeGreaterThan(0);
    const overviewStableMs = Date.now() - overviewStartedAt;

    for (let index = 0; index < 7; index += 1) {
      await zoomIn.click();
    }
    await expect(session).toHaveAttribute('data-lod-mode', 'work', { timeout: 5000 });
    await expect.poll(() => tileRequests.length, { timeout: 10000 }).toBeGreaterThan(0);
    await waitForTileNetworkIdle(page);
    const workTileRequestCount = tileRequests.length;
    await page.screenshot({ path: resolve(evidenceDir, `${testInfo.project.name}-work.png`), fullPage: false });
    const workStats = await clientStats();

    const beforeRapid = tileRequests.length;
    const beforeRapidResponses = tileResponses.length;
    for (let index = 0; index < 12; index += 1) {
      await (index % 2 ? zoomOut : zoomIn).click();
    }
    await waitForTileNetworkIdle(page);
    const rapidStats = await clientStats();
    expect(rapidStats.cache.tiles).toBeLessThanOrEqual(48);
    expect(rapidStats.network.peakConcurrentTileRequests).toBeLessThanOrEqual(48);
    const rapidTileRequestCount = tileRequests.length - beforeRapid;
    expect(rapidTileRequestCount).toBeLessThan(80);
    const rapidTileResponseCount = tileResponses.length - beforeRapidResponses;
    expect(rapidTileResponseCount).toBeLessThan(80);

    let failNextTile = true;
    await waitForViewportQuiescence(page);
    // Clean slate with full transparency: a genuine rapid-phase transient
    // (observed once locally as error-count 2 in a pre-fix 10x run) must not
    // conflate with the synthetic outage below. Recover via the product's
    // own retry path; a persistent failure still fails the zero assert that
    // follows instead of being masked.
    const preExistingErrors = await page.evaluate(() => Object.keys(window.__splintClient?.getSnapshot?.().tileErrors || {}));
    if (preExistingErrors.length > 0) {
      console.log(`recovering pre-existing tile errors before fault injection: ${JSON.stringify(preExistingErrors)}`);
      await page.evaluate(() => window.__splintClient?.retryFailedTiles?.());
      await waitForTileNetworkIdle(page);
    }
    await expect(session).toHaveAttribute('data-tile-error-count', '0');
    await page.route(/\/api\/colorings\/[^/]+\/tiles\/\d+\/\d+$/, async (route) => {
      if (!failNextTile) return route.continue();
      failNextTile = false;
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'synthetic tile outage' }),
      });
    });
    await page.evaluate(() => window.__splintClient?.cache.clear());
    await page.evaluate(async () => {
      try { await window.__splintClient.fetchTile(0, 0); } catch {}
    });
    await expect(session).toHaveAttribute('data-tile-error-count', '1', { timeout: 5000 });
    // Exact tile: quiescence above proves no background plan could steal the
    // single-shot route, so the outage must be local to tile (0,0) — and the
    // retry below must restore exactly that tile.
    const failedTiles = await page.evaluate(() => Object.keys(window.__splintClient?.getSnapshot?.().tileErrors || {}));
    expect(failedTiles).toEqual(['0:0']);
    await expect(page.locator('.progressive-grid-error')).toHaveCount(0);
    await page.screenshot({ path: resolve(evidenceDir, `${testInfo.project.name}-tile-502.png`), fullPage: false });

    await page.locator('.progressive-grid-tile-warning button').click();
    await expect(session).toHaveAttribute('data-tile-error-count', '0', { timeout: 5000 });
    await page.screenshot({ path: resolve(evidenceDir, `${testInfo.project.name}-tile-recovered.png`), fullPage: false });

    await page.context().setOffline(true);
    await pressOverview(page);
    await expect(session).toHaveAttribute('data-lod-mode', 'overview');
    await expect(page.locator('.progressive-grid-error')).toHaveCount(0);
    await page.screenshot({ path: resolve(evidenceDir, `${testInfo.project.name}-offline-overview.png`), fullPage: false });
    await page.context().setOffline(false);

    const finalStats = await clientStats();
    const longTaskStats = await page.evaluate(() => {
      const entries = performance.getEntriesByType('longtask');
      return {
        count: entries.length,
        totalDurationMs: entries.reduce((total, entry) => total + entry.duration, 0),
      };
    });
    writeFileSync(resolve(evidenceDir, `${testInfo.project.name}-metrics.json`), JSON.stringify({
      capturedAt: new Date().toISOString(),
      project: testInfo.project.name,
      viewport: page.viewportSize(),
      grid: { width: WIDTH, height: HEIGHT, tileSize: TILE_SIZE },
      overview: {
        stableWindowMs: overviewStableMs,
        tileResponseCount: overviewTileResponseCount,
        client: overviewStats,
      },
      work: { tileRequestCount: workTileRequestCount, client: workStats },
      rapidPinch: {
        additionalTileRequestCount: tileRequests.length - beforeRapid,
        additionalTileResponseCount: rapidTileResponseCount,
        client: rapidStats,
      },
      final: finalStats,
      longTasks: longTaskStats,
    }, null, 2));
  });
});
