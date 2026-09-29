import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const GRID = 160;
const TILE = 32;
const evidenceDir = resolve('docs/evidence/special-cells-long-journey-2026-08-09');
const KINDS = ['spark', 'bomb', 'fuse', 'choice', 'artifact', 'hazard'];

async function createTreatment(page) {
  // The seed hook bounds deterministic owner ids to 24 characters; keep this
  // prefix distinct from the companion evidence fixture.
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': 'user_long_journey_base' });
  const fixtureResponse = await page.request.post('/api/__e2e/seed-cohort-template', {
    data: {
      cohort: 'treatment',
      storage: 'tiled',
      size: { width: GRID, height: GRID },
    },
  });
  expect(fixtureResponse.ok()).toBe(true);
  const fixture = await fixtureResponse.json();
  expect(fixture.cohort).toBe('treatment');
  expect(fixture.storage).toBe('tiled');
  expect(fixture.size).toEqual({ width: GRID, height: GRID });
  const progressResponse = await page.request.get(`/api/colorings/${fixture.id}/progress`);
  expect(progressResponse.ok()).toBe(true);
  const progress = await progressResponse.json();
  expect(progress.specials_experiment_group).toBe('treatment');
  return { created: { id: fixture.id }, progress };
}

async function findSpecials(page, id) {
  const result = [];
  for (let tileY = 0; tileY < Math.ceil(GRID / TILE); tileY += 1) {
    for (let tileX = 0; tileX < Math.ceil(GRID / TILE); tileX += 1) {
      const response = await page.request.get(`/api/colorings/${id}/tiles/${tileX}/${tileY}`);
      expect(response.ok()).toBe(true);
      const tile = await response.json();
      for (const special of tile.specials || []) {
        if (special.state === 'unseen' && KINDS.includes(special.kind)) {
          result.push(special);
        }
      }
    }
  }
  return result.sort((a, b) => Number(a.cell_index) - Number(b.cell_index));
}

function spacedOnePerKind(specials, kinds = KINDS) {
  const chosen = [];
  for (const kind of kinds) {
    const candidate = specials.find((special) => special.kind === kind
      && chosen.every((other) => Math.abs(Number(other.cell_index) - Number(special.cell_index)) > 32));
    if (candidate) chosen.push(candidate);
  }
  return chosen;
}

async function moveToCell(page, canvas, cellIndex) {
  const x = Number(cellIndex) % GRID;
  const y = Math.floor(Number(cellIndex) / GRID);
  await expect(canvas).toBeVisible();
  const tileX = Math.floor(x / TILE);
  const tileY = Math.floor(y / TILE);
  await page.evaluate(async ({ tileX: requestedTileX, tileY: requestedTileY }) => {
    const client = window.__splintClient;
    await client?.loadManifest?.();
    await client?.fetchTile(requestedTileX, requestedTileY, { force: true });
    client?.cache?.pin?.(`${requestedTileX}:${requestedTileY}`);
  }, { tileX, tileY });
  const minimap = page.locator('.progressive-grid-minimap-canvas');
  const minimapBox = await minimap.boundingBox();
  expect(minimapBox).toBeTruthy();
  await minimap.click({
    position: {
      x: ((x + 0.5) / GRID) * minimapBox.width,
      y: ((y + 0.5) / GRID) * minimapBox.height,
    },
  });
  await expect.poll(
    () => page.evaluate(({ cellX, cellY }) => Boolean(window.__splintClient?.getCell(cellX, cellY)?.loaded), { cellX: x, cellY: y }),
    { timeout: 30000 },
  ).toBe(true);
  return page.locator('.progressive-grid-area').evaluate((area, cell) => {
    const bounds = area.getBoundingClientRect();
    const camera = {
      x: Number(area.dataset.cameraX),
      y: Number(area.dataset.cameraY),
      zoom: Number(area.dataset.cameraZoom),
    };
    return {
      x: bounds.x + camera.x + (cell.x + 0.5) * 32 * camera.zoom,
      y: bounds.y + camera.y + (cell.y + 0.5) * 32 * camera.zoom,
    };
  }, { x, y });
}

async function claimSpecial(page, id, special) {
  const canvas = page.locator('.progressive-grid-area > canvas');
  const point = await moveToCell(page, canvas, Number(special.cell_index));
  const claimPromise = page.waitForResponse(actionRequest(id, `claim_${special.kind}`), { timeout: 30000 });
  const actionTypes = {
    spark: 'use_spark', bomb: 'use_bomb', fuse: 'disarm_fuse',
    choice: 'use_choice', hazard: 'disarm_hazard',
  };
  const firstUsePromise = actionTypes[special.kind]
    ? page.waitForResponse(actionRequest(id, actionTypes[special.kind]), { timeout: 30000 })
    : null;
  await page.mouse.click(point.x, point.y);
  const claimResponse = await claimPromise;
  expect(claimResponse.status()).toBe(200);
  const claimed = await claimResponse.json();
  expect(claimed.special_discovered).toEqual(expect.objectContaining({ special_id: special.id, kind: special.kind }));
  let used = null;
  let waitForResolved = null;
  if (firstUsePromise) {
    const useResponse = await firstUsePromise;
    expect(useResponse.status()).toBe(200);
    used = await useResponse.json();
    waitForResolved = () => expect.poll(async () => {
      const response = await page.request.get(`/api/colorings/${id}/progress`);
      return (await response.json()).special_offer;
    }, { timeout: 30000 }).toBeNull();
  }
  return { claimed, used, waitForResolved };
}

function actionRequest(id, type) {
  return (response) => {
    if (!response.url().includes(`/colorings/${id}/progress/actions`)
      || response.request().method() !== 'POST') return false;
    try {
      return response.request().postDataJSON()?.special_action?.type === type;
    } catch {
      return false;
    }
  };
}

test('treatment long journey resolves active special kinds without leaving the Canvas', async ({ page, browserName }, testInfo) => {
  test.skip(browserName === 'webkit', 'long journey verifier targets the Chromium pointer/keyboard contract');
  test.setTimeout(240000);
  mkdirSync(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: testInfo.project.name === 'Mobile Pixel' ? 412 : 390, height: 844 });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });

  const { created } = await createTreatment(page);
  const specials = await findSpecials(page, created.id);
  const availableKinds = KINDS.filter((kind) => specials.some((special) => special.kind === kind));
  for (const kind of ['spark', 'bomb', 'fuse', 'artifact', 'hazard']) expect(availableKinds).toContain(kind);
  const selected = spacedOnePerKind(specials, availableKinds);
  expect(new Set(selected.map((special) => special.kind)).size).toBe(availableKinds.length);

  await page.goto(`/?splintMetrics=1&coloring=${created.id}`);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toBeVisible({ timeout: 15000 });
  await expect(session).toHaveAttribute('data-special-treatment', 'treatment', { timeout: 15000 });
  const canvas = page.locator('.progressive-grid-area > canvas');
  await expect(canvas).toBeVisible({ timeout: 15000 });
  await page.locator('.player-menu-btn').click();
  const revealAction = page.locator('.bottom-sheet-actions button', { hasText: '\u0420\u0435\u0436\u0438\u043c \u0440\u0430\u0441\u043a\u0440\u044b\u0442\u0438\u044f' });
  if (await revealAction.isVisible().catch(() => false)) await revealAction.click();
  else await page.locator('.bottom-sheet-close').click().catch(() => {});

  const resolved = [];
  for (const special of selected) {
    const { claimed, used, waitForResolved } = await claimSpecial(page, created.id, special);
    expect(claimed.special_offer?.kind || special.kind).toBe(special.kind);
    await expect(page.locator('[data-special-auto-applying]')).toHaveCount(0);
    await expect(page.locator('[data-bomb-center-direction], [data-bomb-use], [data-fuse-disarm], [data-special-option], [data-special-action="use"]')).toHaveCount(0);
    await expect(page.locator(`[data-special-fx="${special.kind}"]`)).toBeVisible({ timeout: 15000 });
    if (used) {
      expect(used.special_applied_changes.length).toBeGreaterThan(0);
      expect(used.special_applied_changes.length).toBeLessThanOrEqual(special.kind === 'spark' ? 144 : special.kind === 'hazard' ? 16 : 32);
    }
    resolved.push({ kind: special.kind, special_id: special.id, cell_index: Number(special.cell_index) });
    await page.screenshot({
      path: resolve(evidenceDir, `${testInfo.project.name}-${special.kind}.png`),
      fullPage: false,
    });
    if (waitForResolved) await waitForResolved();
    if (special.kind === 'hazard') {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(page.locator('[data-special-fx="hazard"]')).toHaveClass(/special-fx-reduced/);
      await page.screenshot({
        path: resolve(evidenceDir, `${testInfo.project.name}-hazard-reduced-motion.png`),
        fullPage: false,
      });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    }
  }

  expect(resolved.map((entry) => entry.kind).sort()).toEqual([...availableKinds].sort());
  writeFileSync(resolve(evidenceDir, `${testInfo.project.name}-metrics.json`), JSON.stringify({
    capturedAt: new Date().toISOString(),
    project: testInfo.project.name,
    viewport: page.viewportSize(),
    fixture: { template_id: created.id, grid: `${GRID}x${GRID}` },
    available_specials: specials.length,
    resolved,
  }, null, 2));
});
