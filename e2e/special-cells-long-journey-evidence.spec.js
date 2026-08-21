import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const GRID = 160;
const TILE = 32;
const evidenceDir = resolve('docs/evidence/special-cells-long-journey-evidence-2026-08-09');

async function createTreatment(page) {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': 'user_special_long_journey_evidence' });
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
        if (special.state === 'unseen') result.push(special);
      }
    }
  }
  return result.sort((a, b) => Number(a.cell_index) - Number(b.cell_index));
}

function spacedOnePerKind(specials) {
  const kinds = ['spark', 'bomb', 'artifact'];
  const chosen = [];
  for (const kind of kinds) {
    const candidate = specials.find((special) => special.kind === kind
      && chosen.every((other) => Math.abs(Number(other.cell_index) - Number(special.cell_index)) > 32));
    if (candidate) chosen.push(candidate);
  }
  return chosen;
}

async function moveToCell(canvas, cellIndex) {
  const x = Number(cellIndex) % GRID;
  const y = Math.floor(Number(cellIndex) / GRID);
  await canvas.focus();
  await canvas.press('Home');
  for (let step = 0; step < x; step += 1) await canvas.press('ArrowRight');
  for (let step = 0; step < y; step += 1) await canvas.press('ArrowDown');
  await expect(canvas).toHaveAttribute('data-keyboard-cell', String(cellIndex));
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

async function resolveSpecialAction(page, id, actionType, actionLocator, fuse = false) {
  let last = null;
  do {
    const usePromise = page.waitForResponse(actionRequest(id, actionType), { timeout: 20000 });
    await actionLocator.click();
    const useResponse = await usePromise;
    expect(useResponse.status()).toBe(200);
    last = await useResponse.json();
    if (fuse && last.special_offer?.kind === 'fuse') {
      const nextOffer = page.locator('.progressive-grid-special-offer[data-special-kind="fuse"]');
      await expect(nextOffer).toBeVisible({ timeout: 15000 });
      actionLocator = nextOffer.locator('[data-fuse-disarm]');
      await expect(actionLocator).toBeVisible();
    }
  } while (fuse && last.special_offer?.kind === 'fuse');
  return last;
}

async function isInViewport(locator) {
  if (!(await locator.count())) return false;
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewport = {
      width: window.innerWidth || document.documentElement.clientWidth,
      height: window.innerHeight || document.documentElement.clientHeight,
    };
    return rect.left < viewport.width
      && rect.right > 0
      && rect.top < viewport.height
      && rect.bottom > 0;
  });
}

test('long journey evidence screenshots show active offers and Canvas return', async ({ page, browserName }, testInfo) => {
  test.skip(browserName === 'webkit', 'long journey evidence verifier targets the Chromium keyboard contract');
  test.setTimeout(240000);
  mkdirSync(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: testInfo.project.name === 'Mobile Pixel' ? 412 : 390, height: 844 });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });

  const { created } = await createTreatment(page);
  const selected = spacedOnePerKind(await findSpecials(page, created.id));
  expect(selected.map((special) => special.kind).sort()).toEqual(['artifact', 'bomb', 'spark']);
  // Artifact has no offer action and is already exercised by the existing
  // long-journey spec; the evidence spec focuses on active offers plus Canvas
  // return for the two actionable kinds.
  const actionable = selected.filter((special) => special.kind !== 'artifact');

  await page.goto(`/?coloring=${created.id}`);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toBeVisible({ timeout: 15000 });
  const canvas = page.locator('.progressive-grid-area > canvas');
  await expect(canvas).toBeVisible({ timeout: 15000 });

  const resolved = [];
  const evidence = [];
  for (const special of actionable) {
    await moveToCell(canvas, special.cell_index);
    const claimPromise = page.waitForResponse(actionRequest(created.id, `claim_${special.kind}`), { timeout: 20000 });
    await canvas.press('Enter');
    const claimResponse = await claimPromise;
    expect(claimResponse.status()).toBe(200);
    const claimed = await claimResponse.json();
    expect(claimed.special_discovered).toEqual(expect.objectContaining({ special_id: special.id, kind: special.kind }));

    const offer = page.locator(`.progressive-grid-special-offer[data-special-kind="${special.kind}"]`);
    await expect(offer).toBeVisible({ timeout: 10000 });
    await expect(canvas).toBeVisible();
    const offerInViewport = await isInViewport(offer);
    const canvasInViewport = await isInViewport(canvas);
    expect(offerInViewport).toBe(true);
    expect(canvasInViewport).toBe(true);
    await page.screenshot({
      path: resolve(evidenceDir, `${testInfo.project.name}-${special.kind}-offer.png`),
      fullPage: false,
    });
    evidence.push({
      kind: special.kind,
      phase: 'offer',
      offer_kind: special.kind,
      offer_in_viewport: offerInViewport,
      canvas_in_viewport: canvasInViewport,
      canvas_count: await canvas.count(),
    });

    let actionLocator;
    if (special.kind === 'spark') actionLocator = offer.locator('[data-special-option="a"]');
    if (special.kind === 'bomb') actionLocator = offer.locator('[data-bomb-use]');
    await expect(actionLocator).toBeVisible();
    const actionType = special.kind === 'spark' ? 'use_spark' : 'use_bomb';
    const used = await resolveSpecialAction(page, created.id, actionType, actionLocator);
    await expect(page.locator('.progressive-grid-special-offer')).toHaveCount(0, { timeout: 15000 });
    expect(used.special_applied_changes.length).toBeGreaterThan(0);
    expect(used.special_applied_changes.length).toBeLessThanOrEqual(special.kind === 'spark' ? 144 : 32);

    const afterUse = {
      offers: await page.locator('.progressive-grid-special-offer').count(),
      discoveredChip: await page.locator('[data-special-discovered]').count(),
      canvasVisible: await canvas.isVisible(),
      canvasInViewport: await isInViewport(canvas),
    };
    await page.screenshot({
      path: resolve(evidenceDir, `${testInfo.project.name}-${special.kind}-canvas-return.png`),
      fullPage: false,
    });
    evidence.push({ kind: special.kind, phase: 'canvas-return', ...afterUse });
    resolved.push({ kind: special.kind, special_id: special.id, cell_index: Number(special.cell_index) });
  }

  writeFileSync(resolve(evidenceDir, `${testInfo.project.name}-metrics.json`), JSON.stringify({
    capturedAt: new Date().toISOString(),
    project: testInfo.project.name,
    viewport: page.viewportSize(),
    fixture: { template_id: created.id, grid: `${GRID}x${GRID}` },
    resolved,
    evidence,
  }, null, 2));
});
