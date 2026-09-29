import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { generateSpecialCells } from '../server/services/tiled-specials.js';

const GRID = 1200;
const TILE = 32;
const evidenceDir = resolve('docs/evidence/special-cells-gameplay-v1');
// Alpha keeps one positive-event family plus passive Artifact in the player
// journey. Fuse, Choice and Hazard remain compatibility/server paths and are
// covered by their focused server contracts rather than this legacy journey.
// Alpha promotes one positive event (Spark) plus passive Artifact. Bomb has
// its own challenger verifier and is not mixed into the baseline journey.
const EVENT_KINDS = ['spark', 'artifact'];

function tiledPayload(width, height, tileSize = TILE) {
  const result = [];
  for (let tileY = 0; tileY < Math.ceil(height / tileSize); tileY += 1) {
    for (let tileX = 0; tileX < Math.ceil(width / tileSize); tileX += 1) {
      const tileWidth = Math.min(tileSize, width - tileX * tileSize);
      const tileHeight = Math.min(tileSize, height - tileY * tileSize);
      result.push({
        tile_x: tileX,
        tile_y: tileY,
        width: tileWidth,
        height: tileHeight,
        cells: Array(tileWidth * tileHeight).fill(0),
      });
    }
  }
  return result;
}

async function createTreatment(page) {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': 'user_special_gameplay_v1' });
  const fixtureResponse = await page.request.post('/api/__e2e/seed-cohort-template', {
    data: {
      cohort: 'treatment',
      storage: 'tiled',
      size: { width: GRID, height: GRID },
    },
    timeout: 120000,
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

function findSpecials(id) {
  const tiles = tiledPayload(GRID, GRID);
  const generated = generateSpecialCells({
    templateId: id,
    width: GRID,
    height: GRID,
    tileSize: TILE,
    tiles,
  });
  return generated
    .map((cell) => ({ ...cell, id: cell.special_id, state: 'unseen' }))
    .sort((a, b) => Number(a.cell_index) - Number(b.cell_index));
}

async function verifySelectedMetadata(page, id, selected) {
  const tileKeys = new Set(selected.map((special) => {
    const x = Number(special.cell_index) % GRID;
    const y = Math.floor(Number(special.cell_index) / GRID);
    return `${Math.floor(x / TILE)}:${Math.floor(y / TILE)}`;
  }));
  for (const key of tileKeys) {
    const [tileX, tileY] = key.split(':');
    const response = await page.request.get(`/api/colorings/${id}/tiles/${tileX}/${tileY}`);
    expect(response.ok()).toBe(true);
    const tile = await response.json();
    const selectedIds = selected.filter((special) => {
      const x = Number(special.cell_index) % GRID;
      const y = Math.floor(Number(special.cell_index) / GRID);
      return `${Math.floor(x / TILE)}:${Math.floor(y / TILE)}` === key;
    }).map((special) => special.id);
    for (const specialId of selectedIds) {
      expect(tile.specials.some((special) => special.id === specialId && special.state === 'unseen')).toBe(true);
    }
  }
}

function distance(first, second) {
  const firstX = Number(first.cell_index) % GRID;
  const firstY = Math.floor(Number(first.cell_index) / GRID);
  const secondX = Number(second.cell_index) % GRID;
  const secondY = Math.floor(Number(second.cell_index) / GRID);
  return Math.hypot(firstX - secondX, firstY - secondY);
}

function tileKey(special) {
  const x = Number(special.cell_index) % GRID;
  const y = Math.floor(Number(special.cell_index) / GRID);
  return `${Math.floor(x / TILE)}:${Math.floor(y / TILE)}`;
}

function chooseSpaced(specials, kinds) {
  const selected = [];
  for (const kind of kinds) {
    const candidate = specials.find((special) => special.kind === kind
      && selected.every((other) => distance(special, other) >= 48 && tileKey(special) !== tileKey(other)));
    if (candidate) selected.push(candidate);
  }
  return selected;
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

async function claimSpecial(page, id, canvas, special) {
  const progressResponse = await page.request.get(`/api/colorings/${id}/progress`);
  expect(progressResponse.ok()).toBe(true);
  const progress = await progressResponse.json();
  const claim = await page.request.post(`/api/colorings/${id}/progress/actions`, {
    data: {
      revision: Number(progress.revision || 0),
      clientBatchId: `alpha-rc-gameplay-${special.kind}-${special.id}`,
      changes: [{ index: special.cell_index, color: 0 }],
      special_action: {
        type: `claim_${special.kind}`,
        special_id: special.id,
        session_game: true,
        experiment_group: 'treatment',
      },
    },
  });
  expect(claim.ok()).toBe(true);
  const body = await claim.json();
  expect(body.special_discovered).toEqual(expect.objectContaining({ special_id: special.id, kind: special.kind }));
  const actionType = ({
    spark: 'use_spark', bomb: 'use_bomb', fuse: 'disarm_fuse',
    choice: 'use_choice', hazard: 'disarm_hazard',
  })[special.kind];
  const automaticAction = actionType
    ? page.waitForResponse(actionRequest(id, actionType), { timeout: 90000 })
    : null;
  await page.reload();
  await expect(page.locator('.progressive-coloring-session')).toHaveAttribute('data-special-treatment', 'treatment', { timeout: 30000 });
  let autoApplied = null;
  if (automaticAction) {
    const response = await automaticAction;
    expect(response.status()).toBe(200);
    autoApplied = await response.json();
    await expect.poll(async () => {
      const responseProgress = await page.request.get(`/api/colorings/${id}/progress`);
      return (await responseProgress.json()).special_offer;
    }, { timeout: 30000 }).toBeNull();
  }
  return { ...body, autoApplied };
}

async function resolveOffer(page, id, special, claimed) {
  if (special.kind === 'artifact') {
    await expect(page.locator('[data-special-discovered]')).toBeVisible({ timeout: 15000 });
    return;
  }
  expect(claimed.autoApplied).toBeTruthy();
  expect(claimed.autoApplied.special_applied_changes.length).toBeGreaterThan(0);
  expect(claimed.autoApplied.special_applied_changes.length).toBeLessThanOrEqual(special.kind === 'spark' ? 144 : 32);
  await expect(page.locator('[data-special-auto-applying], [data-special-action="use"], [data-bomb-center-direction], [data-fuse-disarm], [data-special-option]')).toHaveCount(0);
  await expect(page.locator('.progressive-grid-special-offer')).toHaveCount(0, { timeout: 30000 });
}

test('1200x1200 Alpha journey crosses active positive and rare events with reload/offline recovery', async ({ page, browserName }, testInfo) => {
  test.skip(browserName === 'webkit', 'Gameplay v1 journey targets the Chromium tiled canvas contract');
  test.setTimeout(360000);
  mkdirSync(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: testInfo.project.name === 'Mobile Pixel' ? 412 : 390, height: 844 });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });

  const { created } = await createTreatment(page);
  const specials = findSpecials(created.id);
  const selected = chooseSpaced(specials, EVENT_KINDS);
  expect(new Set(selected.map((special) => special.kind)).size).toBe(EVENT_KINDS.length);
  const usedArtifactTiles = new Set(selected.map(tileKey));
  const artifacts = [];
  for (const special of specials.filter((candidate) => candidate.kind === 'artifact')) {
    if (usedArtifactTiles.has(tileKey(special))) continue;
    artifacts.push(special);
    usedArtifactTiles.add(tileKey(special));
    if (artifacts.length === 3) break;
  }
  expect(artifacts.length).toBe(3);
  await verifySelectedMetadata(page, created.id, [...selected, ...artifacts]);

  // Exercise the explicit Alpha baseline (spark_choice) rather than the
  // legacy non-session auto-apply fallback.
  await page.goto(`/?splintMetrics=1&coloring=${created.id}&phase2=session&phase2Variant=treatment&phase2Event=spark_choice&phase2Subject=phase2_special_gameplay`);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toBeVisible({ timeout: 30000 });
  await expect(session).toHaveAttribute('data-special-treatment', 'treatment', { timeout: 30000 });
  const canvas = page.locator('.progressive-grid-area > canvas');
  await expect(canvas).toBeVisible({ timeout: 30000 });
  await page.locator('.player-menu-btn').click();
  const revealAction = page.locator('.bottom-sheet-actions button', { hasText: '\u0420\u0435\u0436\u0438\u043c \u0440\u0430\u0441\u043a\u0440\u044b\u0442\u0438\u044f' });
  if (await revealAction.isVisible().catch(() => false)) await revealAction.click();
  else await page.locator('.bottom-sheet-close').click().catch(() => {});

  const resolved = [];
  for (const special of selected) {
    const claimed = await claimSpecial(page, created.id, canvas, special);
    await page.screenshot({ path: resolve(evidenceDir, `${testInfo.project.name}-${special.kind}-offer.png`), fullPage: false });
    await resolveOffer(page, created.id, special, claimed);
    resolved.push(special.kind);
  }
  expect(resolved).toEqual(EVENT_KINDS);

  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await expect(session).toBeVisible();
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  const manifestReload = page.waitForResponse((response) => response.url().includes(`/colorings/${created.id}/manifest`) && response.status() === 200, { timeout: 30000 });
  await page.reload();
  await manifestReload;
  await expect(session).toHaveAttribute('data-special-treatment', 'treatment', { timeout: 30000 });

  for (const artifact of artifacts) {
    await claimSpecial(page, created.id, canvas, artifact);
    await expect(page.locator('[data-special-discovered]')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(250);
  }
  await expect(page.locator('[data-artifact-progress]')).toHaveAttribute('data-artifact-fragments', '3', { timeout: 30000 });
  await expect(page.locator('[data-artifact-progress]')).toHaveAttribute('data-artifact-total', '3', { timeout: 30000 });
  await page.reload();
  await expect(session).toHaveAttribute('data-special-treatment', 'treatment', { timeout: 30000 });
  await expect(page.locator('[data-artifact-progress]')).toHaveAttribute('data-artifact-fragments', '3', { timeout: 30000 });
  await expect(page.locator('[data-artifact-progress]')).toHaveAttribute('data-artifact-total', '3', { timeout: 30000 });
  await page.screenshot({ path: resolve(evidenceDir, `${testInfo.project.name}-journey-final.png`), fullPage: false });
});
