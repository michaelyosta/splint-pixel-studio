import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const GRID = 1200;
const TILE = 32;
const widths = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];
const evidenceDir = resolve('docs', 'evidence', 'special-cells-visual-audit-2026-08-12');

async function seedTreatment(page, label, isolationKey = 'base') {
  // The seed hook is intentionally idempotent for a given user. Keep the
  // invocation key in the prefix because the server truncates owner ids when
  // deriving deterministic fixture ids. This prevents repeat-each/retry
  // attempts from reusing a mutable Spark-progress row.
  const userId = `e2e_va_${isolationKey}_${label}`;
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': userId });
  const response = await page.request.post('/api/__e2e/seed-cohort-template', {
    data: { cohort: 'treatment', storage: 'tiled', size: { width: GRID, height: GRID } },
    timeout: 120000,
  });
  expect(response.ok()).toBe(true);
  const fixture = await response.json();
  expect(fixture.cohort).toBe('treatment');
  expect(fixture.storage).toBe('tiled');
  return fixture.id;
}

async function dismissOnboarding(page) {
  const skip = page.locator('.onboarding-card .secondary-button');
  if (await skip.isVisible().catch(() => false)) await skip.click({ force: true });
}

async function waitForWork(page, { storedOffer = false } = {}) {
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toHaveAttribute('data-special-treatment', 'treatment', { timeout: 30000 });
  await expect(session).toHaveAttribute('data-lod-mode', 'work', { timeout: 30000 });
  if (storedOffer) {
    await expect(page.locator('.progressive-grid-special-offer[data-special-kind="spark"]')).toBeVisible({ timeout: 30000 });
  } else {
    await expect(session).toHaveAttribute('data-smart-state', 'ready', { timeout: 30000 });
  }
  // A persisted Spark offer intentionally replaces the normal Smart guide;
  // asserting both would make this evidence test depend on an obsolete HUD
  // state rather than the current offer contract.
  if (!storedOffer) {
    await expect(page.locator('.progressive-grid-guide')).toBeVisible({ timeout: 15000 });
  }
  await page.waitForTimeout(450);
}

async function readState(page) {
  return page.evaluate(() => {
    const session = document.querySelector('.progressive-coloring-session');
    const area = document.querySelector('.progressive-grid-area');
    const bounds = area?.getBoundingClientRect();
    const targetX = Number(session?.dataset.smartTargetX);
    const targetY = Number(session?.dataset.smartTargetY);
    const camera = {
      x: Number(area?.dataset.cameraX),
      y: Number(area?.dataset.cameraY),
      zoom: Number(area?.dataset.cameraZoom),
    };
    const point = bounds && Number.isFinite(targetX) && Number.isFinite(targetY)
      ? {
        x: bounds.x + targetX * 32 * camera.zoom + camera.x + 16 * camera.zoom,
        y: bounds.y + targetY * 32 * camera.zoom + camera.y + 16 * camera.zoom,
      }
      : null;
    const hudRects = [...document.querySelectorAll('.progressive-grid-area > *')]
      .filter((element) => !element.classList.contains('progressive-grid-minimap-canvas'))
      .map((element) => ({ className: String(element.className || ''), rect: element.getBoundingClientRect().toJSON() }));
    return {
      viewport: { width: innerWidth, height: innerHeight },
      mode: session?.dataset.lodMode,
      smartState: session?.dataset.smartState,
      treatment: session?.dataset.specialTreatment,
      target: {
        x: targetX,
        y: targetY,
        minX: Number(session?.dataset.smartTargetMinX),
        minY: Number(session?.dataset.smartTargetMinY),
        maxX: Number(session?.dataset.smartTargetMaxX),
        maxY: Number(session?.dataset.smartTargetMaxY),
      },
      camera,
      area: bounds?.toJSON() || null,
      targetPoint: point,
      targetInsideCanvas: Boolean(bounds && point
        && point.x >= bounds.x && point.x <= bounds.right
        && point.y >= bounds.y && point.y <= bounds.bottom),
      hudRects,
      offer: Boolean(document.querySelector('.progressive-grid-special-offer')),
      wave: document.querySelector('[data-special-wave]')?.dataset.specialWaveCells || null,
      returnTarget: Boolean(document.querySelector('[data-return-target]')),
    };
  });
}

async function fetchTargetSpark(page, id, state, specialId) {
  const [tileX, tileY] = String(`${Math.floor(state.target.x / TILE)}:${Math.floor(state.target.y / TILE)}`).split(':').map(Number);
  const response = await page.request.get(`/api/colorings/${id}/tiles/${tileX}/${tileY}`);
  expect(response.ok()).toBe(true);
  const tile = await response.json();
  const spark = (tile.specials || []).find((special) => {
    if (special.kind !== 'spark' || special.state !== 'unseen') return false;
    if (specialId && special.id !== specialId) return false;
    const x = Number(special.cell_index) % GRID;
    const y = Math.floor(Number(special.cell_index) / GRID);
    return x >= state.target.minX && x <= state.target.maxX
      && y >= state.target.minY && y <= state.target.maxY;
  });
  expect(spark, `target tile ${tileX}:${tileY} must expose the initial Spark`).toBeTruthy();
  return {
    tile,
    tileX,
    tileY,
    x: Number(spark.cell_index) % GRID,
    y: Math.floor(Number(spark.cell_index) / GRID),
    specialId: spark.id,
  };
}

async function claimSpark(page, id, spark) {
  // The production Phase 2 contract deliberately hides Special markers until
  // the first manual segment reveal. This visual-only audit already verifies
  // the responsive Canvas/treatment presentation, so use the server action to
  // enter the persisted offer state deterministically instead of bypassing the
  // current arming rule with a synthetic touch.
  const response = await page.request.post(`/api/colorings/${id}/progress/actions`, {
    data: {
      revision: 0,
      clientBatchId: `visual-audit-claim-${spark.specialId}`,
      changes: [{ index: spark.y * GRID + spark.x, color: 0 }],
      special_action: {
        type: 'claim_spark',
        special_id: spark.specialId,
        session_game: true,
        experiment_group: 'treatment',
      },
    },
  });
  expect(response.status()).toBe(200);
  return response.json();
}

async function auditWidth(page, size, index, { reducedMotion = false, isolationKey = 'base' } = {}) {
  await page.setViewportSize(size);
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  const id = await seedTreatment(
    page,
    `${size.width}_${index}_${reducedMotion ? 'reduced' : 'normal'}`,
    isolationKey,
  );
  const initialGuidanceResponse = page.waitForResponse(
    (response) => response.url().includes(`/colorings/${id}/guidance`) && response.ok(),
    { timeout: 30000 },
  );
  // The evidence captures the explicit Phase 2 session treatment. Without
  // this query the ordinary cohort path intentionally uses the non-session
  // automatic Spark contract, so it cannot expose the two player choices.
  await page.goto(`/?coloring=${id}&phase2=session&phase2Variant=treatment&phase2Event=spark_choice&phase2Subject=phase2_visual_${size.width}_${index}`);
  await dismissOnboarding(page);
  await waitForWork(page);
  const initial = await readState(page);
  expect(initial.targetInsideCanvas).toBe(true);
  expect(initial.target.minX).toBeLessThanOrEqual(initial.target.maxX);
  expect(initial.target.minY).toBeLessThanOrEqual(initial.target.maxY);
  const initialGuidance = await (await initialGuidanceResponse).json();
  expect(initialGuidance.reason).toBe('INITIAL_TARGET');
  const spark = await fetchTargetSpark(page, id, initial, initialGuidance.special_id);
  const initialPath = resolve(evidenceDir, `${size.width}-${reducedMotion ? 'reduced-' : ''}01-initial-work.png`);
  await page.screenshot({ path: initialPath, fullPage: false });

  const claimed = await claimSpark(page, id, spark);
  await page.reload();
  await dismissOnboarding(page);
  await waitForWork(page, { storedOffer: true });
  const offer = page.locator('.progressive-grid-special-offer[data-special-kind="spark"]');
  await expect(offer).toBeVisible({ timeout: 15000 });
  const previewLocators = await offer.locator('[data-phase2-spark-option]').all();
  expect(previewLocators).toHaveLength(2);
  const previews = [];
  for (const preview of previewLocators) {
    const optionId = await preview.getAttribute('data-phase2-spark-option');
    const serverOption = claimed.special_offer.target_options.find((option) => option.option_id === optionId);
    expect(serverOption, `visible Spark option ${optionId} must be server-backed`).toBeTruthy();
    await expect(preview).toContainText(String(serverOption.estimated_cells));
    previews.push({
      option: optionId,
      bounds: [serverOption.bounds.min_x, serverOption.bounds.min_y, serverOption.bounds.max_x, serverOption.bounds.max_y].join(','),
      estimatedCells: Number(serverOption.estimated_cells),
    });
  }
  for (const option of claimed.special_offer.target_options.slice(0, 2)) {
    const expectedBounds = [option.bounds.min_x, option.bounds.min_y, option.bounds.max_x, option.bounds.max_y].join(',');
    const actual = previews.find((preview) => preview.option === option.option_id);
    expect(actual?.bounds).toBe(expectedBounds);
    expect(actual?.estimatedCells).toBe(Number(option.estimated_cells));
  }
  const areaBox = await page.locator('.progressive-grid-area').boundingBox();
  const offerBox = await offer.boundingBox();
  expect(offerBox.x).toBeGreaterThanOrEqual(areaBox.x);
  expect(offerBox.y).toBeGreaterThanOrEqual(areaBox.y);
  expect(offerBox.x + offerBox.width).toBeLessThanOrEqual(areaBox.x + areaBox.width + 1);
  expect(offerBox.y + offerBox.height).toBeLessThanOrEqual(areaBox.y + areaBox.height + 1);
  const offerPath = resolve(evidenceDir, `${size.width}-${reducedMotion ? 'reduced-' : ''}02-spark-offer.png`);
  await page.screenshot({ path: offerPath, fullPage: false });

  const useResponse = page.waitForResponse((response) => {
    if (!response.url().includes('/progress/actions') || response.request().method() !== 'POST') return false;
    try { return response.request().postDataJSON()?.special_action?.type === 'use_spark'; } catch { return false; }
  }, { timeout: 30000 });
  await offer.locator('[data-phase2-spark-option]').first().click();
  const used = await (await useResponse).json();
  expect(used.special_applied_changes.length).toBe(Number(claimed.special_offer.target_options[0].estimated_cells));
  expect(used.special_applied_changes.length).toBeLessThanOrEqual(144);
  const wave = page.locator('[data-special-wave]');
  await expect(wave).toBeVisible({ timeout: 15000 });
  await expect(wave).toHaveAttribute('data-special-wave-kind', 'spark_choice');
  await expect(wave).toHaveAttribute('data-special-wave-cells', String(used.special_applied_changes.length));
  const wavePath = resolve(evidenceDir, `${size.width}-${reducedMotion ? 'reduced-' : ''}03-spark-wave.png`);
  await page.screenshot({ path: wavePath, fullPage: false });
  await expect(offer).toHaveCount(0, { timeout: 15000 });

  // Phase 2 now pauses on an explicit ownership beat after the wave. The old
  // audit pressed into free exploration and expected a return-target HUD,
  // which was replaced by the current "next fragment" continuation contract.
  const nextBeat = page.locator('[data-session-game-next-beat]');
  await expect(nextBeat).toBeVisible({ timeout: 15000 });
  await expect(nextBeat.locator('[data-session-game-continue]')).toBeVisible();
  const nextBeatState = await readState(page);
  const nextBeatPath = resolve(evidenceDir, `${size.width}-${reducedMotion ? 'reduced-' : ''}04-next-beat.png`);
  await page.screenshot({ path: nextBeatPath, fullPage: false });
  await nextBeat.locator('[data-session-game-continue]').click();
  await expect(page.locator('.progressive-coloring-session')).toHaveAttribute('data-smart-state', 'ready', { timeout: 20000 });
  await expect(nextBeat).toHaveCount(0);
  const returned = await readState(page);
  expect(returned.targetInsideCanvas).toBe(true);
  const returnedPath = resolve(evidenceDir, `${size.width}-${reducedMotion ? 'reduced-' : ''}05-next-smart-target.png`);
  await page.screenshot({ path: returnedPath, fullPage: false });
  return {
    size,
    reducedMotion,
    templateId: id,
    initial,
    spark: { x: spark.x, y: spark.y, specialId: spark.specialId },
    preview: previews,
    appliedCells: used.special_applied_changes.length,
    nextBeatState,
    returned,
    screenshots: [initialPath, offerPath, wavePath, nextBeatPath, returnedPath].map((path) => relative(resolve('.'), path).replaceAll('\\', '/')),
  };
}

test('fresh treatment visual audit covers responsive Spark flow and next-beat continuation', async ({ page, browserName }, testInfo) => {
  test.skip(browserName === 'webkit', 'Canvas audit targets Chromium');
  test.setTimeout(360000);
  mkdirSync(evidenceDir, { recursive: true });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('splint_onboarding_version', '2');
      localStorage.setItem('splint_special_help_v1', JSON.stringify({ version: 1, introSeen: true, kinds: ['spark', 'bomb', 'fuse', 'choice', 'artifact', 'hazard'] }));
    } catch {}
  });
  await page.route('https://telegram.org/js/telegram-web-app.js', async (route) => {
    await route.fulfill({ contentType: 'application/javascript', body: 'window.Telegram = window.Telegram || { WebApp: { ready() {} } };' });
  });
  const results = [];
  const isolationKey = `r${testInfo.repeatEachIndex}_t${testInfo.retry}`;
  for (let index = 0; index < widths.length; index += 1) {
    results.push(await auditWidth(page, widths[index], index, { isolationKey }));
  }
  results.push(await auditWidth(page, { width: 390, height: 844 }, 3, {
    reducedMotion: true,
    isolationKey,
  }));
  const jsonPath = resolve(evidenceDir, 'audit.json');
  writeFileSync(jsonPath, JSON.stringify({
    capturedAt: new Date().toISOString(),
    scope: 'treatment 1200x1200 tiled visual-only audit',
    invariants: ['server action payload unchanged', 'no production DB mutation', 'no progress copy audit'],
    sixKindsEvidence: 'docs/evidence/special-glyph-parity/final (fresh tiled 360/390/430 + light/reveal/reduced coverage)',
    results,
  }, null, 2));
  writeFileSync(resolve(evidenceDir, 'README.md'), [
    '# Special Cells visual audit — 2026-08-12',
    '',
    '- Treatment 1200×1200 tiled flow: INITIAL_TARGET → WORK → Spark offer → server-confirmed Smart wave → free exploration → Smart return.',
    '- Responsive sizes: 360×800, 390×844, 430×932; reduced-motion: 390×844.',
    '- Each result records exact persisted target bounds, preview bounds/cell estimate, applied cell count, and screenshot paths.',
    '- Six-kind marker evidence remains in `../special-glyph-parity/final`: Spark, Bomb, Fuse, Choice, Hazard, Artifact; WORK/overview and dark/light/reveal/reduced snapshots are included.',
    '- HUD/Canvas checks assert the target point is inside the Canvas and the Spark offer stays within the Canvas bounds.',
    '',
    'Generated from the isolated E2E treatment fixture; no production server semantics, placement, balance, or type definitions were changed.',
  ].join('\n'));
});
