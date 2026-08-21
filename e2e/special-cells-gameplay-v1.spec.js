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
const EVENT_KINDS = ['spark', 'bomb', 'artifact'];

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

async function moveToCell(canvas, cellIndex) {
  const x = Number(cellIndex) % GRID;
  const y = Math.floor(Number(cellIndex) / GRID);
  await canvas.focus();
  await canvas.press('Home');
  for (let step = 0; step < x; step += 1) await canvas.press('ArrowRight');
  for (let step = 0; step < y; step += 1) await canvas.press('ArrowDown');
  await expect(canvas).toHaveAttribute('data-keyboard-cell', String(cellIndex), { timeout: 30000 });
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
  await moveToCell(canvas, special.cell_index);
  const claimPromise = page.waitForResponse(actionRequest(id, `claim_${special.kind}`), { timeout: 30000 });
  await canvas.press('Enter');
  const claim = await claimPromise;
  expect(claim.status()).toBe(200);
  const body = await claim.json();
  expect(body.special_discovered).toEqual(expect.objectContaining({ special_id: special.id, kind: special.kind }));
  return body;
}

async function resolveOffer(page, id, special, { reloadBeforeUse = false, offlineBeforeUse = false } = {}) {
  if (special.kind === 'artifact') {
    await expect(page.locator('[data-special-discovered]')).toBeVisible({ timeout: 15000 });
    return;
  }
  const offer = page.locator(`.progressive-grid-special-offer[data-special-kind="${special.kind}"]`);
  await expect(offer).toBeVisible({ timeout: 15000 });
  if (reloadBeforeUse) {
    const manifestReload = page.waitForResponse((response) => response.url().includes(`/colorings/${id}/manifest`) && response.status() === 200, { timeout: 30000 });
    await page.reload();
    await manifestReload;
    await expect(page.locator('.progressive-coloring-session')).toHaveAttribute('data-special-treatment', 'treatment', { timeout: 30000 });
    await expect(offer).toBeVisible({ timeout: 30000 });
  }
  if (special.kind === 'fuse') {
    let steps = 0;
    while (await offer.count() && await offer.isVisible().catch(() => false)) {
      const action = offer.locator('[data-fuse-disarm]');
      await expect(action).toBeVisible();
      const usePromise = page.waitForResponse(actionRequest(id, 'disarm_fuse'), { timeout: 30000 });
      await action.click();
      const used = await usePromise;
      expect(used.status()).toBe(200);
      const body = await used.json();
      expect(body.special_applied_changes.length).toBeGreaterThan(0);
      expect(body.special_applied_changes.length).toBeLessThanOrEqual(32);
      steps += 1;
      expect(steps).toBeLessThanOrEqual(3);
      if (!(await offer.count())) break;
      if (!(await offer.isVisible().catch(() => false))) break;
    }
    expect(steps).toBeGreaterThan(0);
  } else if (special.kind === 'spark') {
    const usePromise = page.waitForResponse(actionRequest(id, 'use_spark'), { timeout: 30000 });
    await offer.locator('[data-special-option="a"]').click();
    const used = await usePromise;
    expect(used.status()).toBe(200);
    expect((await used.json()).special_applied_changes.length).toBeGreaterThan(0);
  } else if (special.kind === 'bomb') {
    const usePromise = page.waitForResponse(actionRequest(id, 'use_bomb'), { timeout: 30000 });
    await offer.locator('[data-bomb-use]').click();
    const used = await usePromise;
    expect(used.status()).toBe(200);
    expect((await used.json()).special_applied_changes.length).toBeGreaterThan(0);
  } else if (special.kind === 'hazard') {
    const usePromise = page.waitForResponse(actionRequest(id, 'disarm_hazard'), { timeout: 30000 });
    if (offlineBeforeUse) {
      await page.context().setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await offer.locator('[data-hazard-disarm]').click();
      await expect(offer).toBeVisible({ timeout: 15000 });
      await page.context().setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
    } else {
      await offer.locator('[data-hazard-disarm]').click();
    }
    const used = await usePromise;
    expect(used.status()).toBe(200);
    const body = await used.json();
    expect(body.special_applied_changes.length).toBeGreaterThan(0);
    expect(body.special_applied_changes.length).toBeLessThanOrEqual(16);
  } else if (special.kind === 'choice') {
    const usePromise = page.waitForResponse(actionRequest(id, 'use_choice'), { timeout: 30000 });
    await offer.locator('[data-special-option="smart_target"]').click();
    const used = await usePromise;
    expect(used.status()).toBe(200);
    expect((await used.json()).special_applied_changes.length).toBeGreaterThan(0);
  }
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

  await page.goto(`/?coloring=${created.id}`);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toBeVisible({ timeout: 30000 });
  await expect(session).toHaveAttribute('data-special-treatment', 'treatment', { timeout: 30000 });
  const canvas = page.locator('.progressive-grid-area > canvas');
  await expect(canvas).toBeVisible({ timeout: 30000 });

  const resolved = [];
  for (const special of selected) {
    await claimSpecial(page, created.id, canvas, special);
    await page.screenshot({ path: resolve(evidenceDir, `${testInfo.project.name}-${special.kind}-offer.png`), fullPage: false });
    await resolveOffer(page, created.id, special, {
      reloadBeforeUse: special.kind === 'bomb',
      offlineBeforeUse: special.kind === 'hazard',
    });
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
