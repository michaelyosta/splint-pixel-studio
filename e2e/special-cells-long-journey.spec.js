import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const GRID = 160;
const TILE = 32;
const evidenceDir = resolve('docs/evidence/special-cells-long-journey-2026-08-09');
// Current Alpha journey: bounded positive events plus passive Artifact.
// Fuse and Choice remain compatibility-only server paths, not player-facing
// long-session requirements.
const KINDS = ['spark', 'bomb', 'artifact'];

async function createTreatment(page) {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': 'user_special_long_journey' });
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

function spacedOnePerKind(specials) {
  const chosen = [];
  for (const kind of KINDS) {
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
  const selected = spacedOnePerKind(specials);
  expect(new Set(selected.map((special) => special.kind)).size).toBe(KINDS.length);

  await page.goto(`/?coloring=${created.id}`);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toBeVisible({ timeout: 15000 });
  await expect(session).toHaveAttribute('data-special-treatment', 'treatment', { timeout: 15000 });
  const canvas = page.locator('.progressive-grid-area > canvas');
  await expect(canvas).toBeVisible({ timeout: 15000 });

  const resolved = [];
  for (const special of selected) {
    await moveToCell(canvas, special.cell_index);
    const claimPromise = page.waitForResponse(actionRequest(created.id, `claim_${special.kind}`), { timeout: 20000 });
    await canvas.press('Enter');
    const claimResponse = await claimPromise;
    expect(claimResponse.status()).toBe(200);
    const claimed = await claimResponse.json();
    expect(claimed.special_discovered).toEqual(expect.objectContaining({ special_id: special.id, kind: special.kind }));

    if (special.kind === 'artifact') {
      await expect(page.locator('[data-special-discovered]')).toBeVisible({ timeout: 10000 });
    } else {
      const offer = page.locator(`.progressive-grid-special-offer[data-special-kind="${special.kind}"]`);
      await expect(offer).toBeVisible({ timeout: 10000 });
      let actionLocator;
      if (special.kind === 'spark') actionLocator = offer.locator('[data-special-option="a"]');
      if (special.kind === 'bomb') actionLocator = offer.locator('[data-bomb-use]');
      await expect(actionLocator).toBeVisible();
      const actionType = special.kind === 'spark' ? 'use_spark' : 'use_bomb';
      const used = await resolveSpecialAction(page, created.id, actionType, actionLocator);
      await expect(page.locator('.progressive-grid-special-offer')).toHaveCount(0, { timeout: 15000 });
      expect(used.special_applied_changes.length).toBeGreaterThan(0);
      expect(used.special_applied_changes.length).toBeLessThanOrEqual(special.kind === 'spark' ? 144 : 32);
    }
    resolved.push({ kind: special.kind, special_id: special.id, cell_index: Number(special.cell_index) });
    await page.screenshot({ path: resolve(evidenceDir, `${testInfo.project.name}-${special.kind}.png`), fullPage: false });
  }

  expect(resolved.map((entry) => entry.kind).sort()).toEqual([...KINDS].sort());
  writeFileSync(resolve(evidenceDir, `${testInfo.project.name}-metrics.json`), JSON.stringify({
    capturedAt: new Date().toISOString(),
    project: testInfo.project.name,
    viewport: page.viewportSize(),
    fixture: { template_id: created.id, grid: `${GRID}x${GRID}` },
    available_specials: specials.length,
    resolved,
  }, null, 2));
});
