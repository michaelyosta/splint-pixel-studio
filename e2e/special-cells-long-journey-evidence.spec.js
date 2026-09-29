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
  const kinds = ['spark', 'artifact'];
  const chosen = [];
  for (const kind of kinds) {
    const candidate = specials.find((special) => special.kind === kind
      && chosen.every((other) => Math.abs(Number(other.cell_index) - Number(special.cell_index)) > 32));
    if (candidate) chosen.push(candidate);
  }
  return chosen;
}

async function claimSpecial(page, id, special) {
  const progressResponse = await page.request.get(`/api/colorings/${id}/progress`);
  expect(progressResponse.ok()).toBe(true);
  const progress = await progressResponse.json();
  const claim = await page.request.post(`/api/colorings/${id}/progress/actions`, {
    data: {
      revision: Number(progress.revision || 0),
      clientBatchId: `alpha-rc-evidence-${special.kind}-${special.id}`,
      changes: [{ index: special.cell_index, color: 0 }],
      special_action: {
        type: `claim_${special.kind}`,
        special_id: special.id,
        experiment_group: 'treatment',
      },
    },
  });
  expect(claim.ok()).toBe(true);
  const body = await claim.json();
  expect(body.special_discovered).toEqual(expect.objectContaining({ special_id: special.id, kind: special.kind }));
  const automatic = page.waitForResponse(actionRequest(id, 'use_spark'), { timeout: 30000 });
  await page.reload();
  await expect(page.locator('.progressive-coloring-session')).toHaveAttribute('data-special-treatment', 'treatment', { timeout: 30000 });
  const applied = await automatic;
  expect(applied.status()).toBe(200);
  return { claim: body, applied: await applied.json() };
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
  expect(selected.map((special) => special.kind).sort()).toEqual(['artifact', 'spark']);
  // Artifact has no offer action and is already exercised by the existing
  // long-journey spec; this evidence slice focuses on the active Spark offer.
  const actionable = selected.filter((special) => special.kind !== 'artifact');

  await page.goto(`/?splintMetrics=1&coloring=${created.id}`);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toBeVisible({ timeout: 15000 });
  const canvas = page.locator('.progressive-grid-area > canvas');
  await expect(canvas).toBeVisible({ timeout: 15000 });
  await page.locator('.player-menu-btn').click();
  const revealAction = page.locator('.bottom-sheet-actions button', { hasText: '\u0420\u0435\u0436\u0438\u043c \u0440\u0430\u0441\u043a\u0440\u044b\u0442\u0438\u044f' });
  if (await revealAction.isVisible().catch(() => false)) await revealAction.click();
  else await page.locator('.bottom-sheet-close').click().catch(() => {});

  const resolved = [];
  const evidence = [];
  for (const special of actionable) {
    const { claim, applied: used } = await claimSpecial(page, created.id, special);
    expect(claim.special_offer.kind).toBe(special.kind);
    expect(used.special_applied_changes.length).toBeGreaterThan(0);
    expect(used.special_applied_changes.length).toBeLessThanOrEqual(144);
    const effect = page.locator('[data-special-fx="spark"]');
    await expect(effect).toBeVisible({ timeout: 10000 });
    await expect(canvas).toBeVisible();
    const effectInViewport = await isInViewport(effect);
    const canvasInViewport = await isInViewport(canvas);
    expect(effectInViewport).toBe(true);
    expect(canvasInViewport).toBe(true);
    await expect(page.locator('[data-phase2-spark-option], [data-special-action="use"]')).toHaveCount(0);
    await page.screenshot({
      path: resolve(evidenceDir, `${testInfo.project.name}-${special.kind}-effect.png`),
      fullPage: false,
    });
    evidence.push({
      kind: special.kind,
      phase: 'effect',
      effect_in_viewport: effectInViewport,
      canvas_in_viewport: canvasInViewport,
      canvas_count: await canvas.count(),
    });
    await expect(page.locator('.progressive-grid-special-offer')).toHaveCount(0, { timeout: 15000 });

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
