import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { generateSpecialCells } from '../server/services/tiled-specials.js';
import { generateHazardCells } from '../server/services/tiled-hazard.js';

const GRID = 160;
const TILE = 32;
const evidenceDir = resolve('docs/evidence/special-cells-responsive');

async function createTreatment(page) {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': 'user_special_responsive' });
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
  const progress = await progressResponse.json();
  expect(progress.specials_experiment_group).toBe('treatment');
  return { id: fixture.id };
}

function firstSpark(templateId) {
  const tiles = tiledPayload();
  const generated = generateSpecialCells({
    templateId,
    width: GRID,
    height: GRID,
    tileSize: TILE,
    tiles,
  });
  const hazards = generateHazardCells({
    templateId,
    width: GRID,
    height: GRID,
    tileSize: TILE,
    tiles,
    occupiedIndices: generated.map((cell) => cell.cell_index),
  });
  return [...generated, ...hazards].find((cell) => cell.kind === 'spark');
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

test('tiled special offer stays usable at mobile widths and honors reduced motion', async ({ page, browserName }, testInfo) => {
  test.skip(browserName === 'webkit', 'Chromium projects provide the tiled canvas evidence');
  test.setTimeout(120000);
  mkdirSync(evidenceDir, { recursive: true });
  const forcedWidth = Number(process.env.SPECIAL_RESPONSIVE_WIDTH);
  const width = Number.isInteger(forcedWidth) && forcedWidth >= 320 && forcedWidth <= 480
    ? forcedWidth
    : testInfo.project.name === 'Mobile iPhone'
    ? 430
    : testInfo.project.name === 'Mobile Pixel' ? 412 : 360;
  const reducedMotion = process.env.SPECIAL_RESPONSIVE_REDUCED_MOTION === '1'
    || testInfo.project.name === 'Mobile iPhone';
  await page.setViewportSize({ width, height: 844 });
  if (reducedMotion) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  }
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });

  const created = await createTreatment(page);
  const spark = firstSpark(created.id);
  expect(spark).toBeTruthy();
  await page.goto(`/?coloring=${created.id}`);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toHaveAttribute('data-special-treatment', 'treatment', { timeout: 30000 });
  const area = page.locator('.progressive-grid-area');
  const canvas = area.locator('canvas:not(.progressive-grid-minimap-canvas)');
  await expect(canvas).toBeVisible({ timeout: 30000 });
  if (reducedMotion) {
    await expect(area).toHaveAttribute('data-reduced-motion', 'true');
  }

  await moveToCell(canvas, spark.cell_index);
  const claimPromise = page.waitForResponse((response) => {
    if (!response.url().includes(`/colorings/${created.id}/progress/actions`)
      || response.request().method() !== 'POST') return false;
    try { return response.request().postDataJSON()?.special_action?.type === 'claim_spark'; } catch { return false; }
  });
  await canvas.press('Enter');
  expect((await claimPromise).status()).toBe(200);
  const offer = page.locator('.progressive-grid-special-offer[data-special-kind="spark"]');
  await expect(offer).toBeVisible({ timeout: 30000 });

  const areaBox = await area.boundingBox();
  const offerBox = await offer.boundingBox();
  expect(areaBox).toBeTruthy();
  expect(offerBox).toBeTruthy();
  expect(offerBox.x).toBeGreaterThanOrEqual(areaBox.x);
  expect(offerBox.y).toBeGreaterThanOrEqual(areaBox.y);
  expect(offerBox.x + offerBox.width).toBeLessThanOrEqual(areaBox.x + areaBox.width + 1);
  expect(offerBox.y + offerBox.height).toBeLessThanOrEqual(areaBox.y + areaBox.height + 1);
  for (const button of await offer.locator('button').all()) {
    const buttonBox = await button.boundingBox();
    expect(buttonBox).toBeTruthy();
    expect(buttonBox.x).toBeGreaterThanOrEqual(areaBox.x);
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(areaBox.x + areaBox.width + 1);
  }
  await page.screenshot({ path: resolve(evidenceDir, `${testInfo.project.name}-${width}.png`), fullPage: false });
});
