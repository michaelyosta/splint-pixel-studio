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

function screenPoint(cellX, cellY, camera, box) {
  return {
    x: box.x + cellX * TILE * camera.zoom + camera.x + (TILE / 2) * camera.zoom,
    y: box.y + cellY * TILE * camera.zoom + camera.y + (TILE / 2) * camera.zoom,
  };
}

async function seedTreatment(page, label) {
  const userId = `e2e_visual_audit_${label}`;
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

async function waitForWork(page) {
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toHaveAttribute('data-special-treatment', 'treatment', { timeout: 30000 });
  await expect(session).toHaveAttribute('data-smart-state', 'ready', { timeout: 30000 });
  await expect(session).toHaveAttribute('data-lod-mode', 'work', { timeout: 30000 });
  await expect(page.locator('.progressive-grid-guide')).toBeVisible({ timeout: 15000 });
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

async function claimSpark(page, spark) {
  const area = page.locator('.progressive-grid-area');
  const box = await area.boundingBox();
  const camera = {
    x: Number(await area.getAttribute('data-camera-x')),
    y: Number(await area.getAttribute('data-camera-y')),
    zoom: Number(await area.getAttribute('data-camera-zoom')),
  };
  const point = screenPoint(spark.x, spark.y, camera, box);
  expect(point.y).toBeGreaterThanOrEqual(box.y);
  expect(point.y).toBeLessThanOrEqual(box.y + box.height);
  const touch = await page.context().newCDPSession(page);
  const claimResponse = page.waitForResponse((response) => {
    if (!response.url().includes('/progress/actions') || response.request().method() !== 'POST') return false;
    try { return response.request().postDataJSON()?.special_action?.type === 'claim_spark'; } catch { return false; }
  }, { timeout: 30000 });
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] });
  await page.waitForTimeout(50);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + 1, y: point.y }] });
  await page.waitForTimeout(50);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const response = await claimResponse;
  expect(response.status()).toBe(200);
  return response.json();
}

async function auditWidth(page, size, index, { reducedMotion = false } = {}) {
  await page.setViewportSize(size);
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  const id = await seedTreatment(page, `${size.width}_${index}_${reducedMotion ? 'reduced' : 'normal'}`);
  const initialGuidanceResponse = page.waitForResponse(
    (response) => response.url().includes(`/colorings/${id}/guidance`) && response.ok(),
    { timeout: 30000 },
  );
  await page.goto(`/?coloring=${id}`);
  await dismissOnboarding(page);
  await waitForWork(page);
  const initial = await readState(page);
  expect(initial.targetInsideCanvas).toBe(true);
  expect(initial.target.minX).toBeLessThanOrEqual(initial.target.maxX);
  expect(initial.target.minY).toBeLessThanOrEqual(initial.target.maxY);
  const initialGuidance = await (await initialGuidanceResponse).json();
  expect(initialGuidance.reason).toBe('INITIAL_TARGET');
  expect(initialGuidance.special_id).toBeTruthy();
  const spark = await fetchTargetSpark(page, id, initial, initialGuidance.special_id);
  const initialPath = resolve(evidenceDir, `${size.width}-${reducedMotion ? 'reduced-' : ''}01-initial-work.png`);
  await page.screenshot({ path: initialPath, fullPage: false });

  const claimed = await claimSpark(page, spark);
  const offer = page.locator('.progressive-grid-special-offer[data-special-kind="spark"]');
  await expect(offer).toBeVisible({ timeout: 15000 });
  const previewLocators = await offer.locator('[data-spark-target-preview]').all();
  expect(previewLocators).toHaveLength(2);
  const previews = [];
  for (const preview of previewLocators) {
    previews.push({
      option: await preview.getAttribute('data-spark-target-option'),
      bounds: await preview.getAttribute('data-spark-bounds'),
      estimatedCells: Number(await preview.getAttribute('data-spark-estimated-cells')),
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
  await offer.locator('[data-special-option="a"]').click();
  const used = await (await useResponse).json();
  expect(used.special_applied_changes.length).toBe(Number(claimed.special_offer.target_options[0].estimated_cells));
  expect(used.special_applied_changes.length).toBeLessThanOrEqual(144);
  const wave = page.locator('[data-special-wave]');
  await expect(wave).toBeVisible({ timeout: 15000 });
  await expect(wave).toHaveAttribute('data-special-wave-kind', 'spark');
  await expect(wave).toHaveAttribute('data-special-wave-cells', String(used.special_applied_changes.length));
  const wavePath = resolve(evidenceDir, `${size.width}-${reducedMotion ? 'reduced-' : ''}03-spark-wave.png`);
  await page.screenshot({ path: wavePath, fullPage: false });
  await expect(offer).toHaveCount(0, { timeout: 15000 });

  const canvas = page.locator('.progressive-grid-area > canvas').first();
  await canvas.focus();
  await canvas.press('Shift+ArrowDown');
  await expect(page.locator('[data-return-target]')).toBeVisible({ timeout: 10000 });
  const freeState = await readState(page);
  expect(freeState.returnTarget).toBe(true);
  const returnPath = resolve(evidenceDir, `${size.width}-${reducedMotion ? 'reduced-' : ''}04-free-exploration.png`);
  await page.screenshot({ path: returnPath, fullPage: false });
  await page.locator('[data-return-target]').click();
  await expect(page.locator('.progressive-coloring-session')).toHaveAttribute('data-smart-state', 'ready', { timeout: 20000 });
  await expect(page.locator('[data-return-target]')).toHaveCount(0);
  const returned = await readState(page);
  expect(returned.targetInsideCanvas).toBe(true);
  const returnedPath = resolve(evidenceDir, `${size.width}-${reducedMotion ? 'reduced-' : ''}05-return-smart-target.png`);
  await page.screenshot({ path: returnedPath, fullPage: false });
  return {
    size,
    reducedMotion,
    templateId: id,
    initial,
    spark: { x: spark.x, y: spark.y, specialId: spark.specialId },
    preview: previews,
    appliedCells: used.special_applied_changes.length,
    freeState,
    returned,
    screenshots: [initialPath, offerPath, wavePath, returnPath, returnedPath].map((path) => relative(resolve('.'), path).replaceAll('\\', '/')),
  };
}

test('fresh treatment visual audit covers responsive Spark flow and Smart return', async ({ page, browserName }) => {
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
  for (let index = 0; index < widths.length; index += 1) {
    results.push(await auditWidth(page, widths[index], index));
  }
  results.push(await auditWidth(page, { width: 390, height: 844 }, 3, { reducedMotion: true }));
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
