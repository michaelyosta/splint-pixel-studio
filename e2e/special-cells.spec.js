import { test, expect } from '@playwright/test';

function tiledPayload(width, height, tileSize = 32) {
  const result = [];
  for (let tileY = 0; tileY < Math.ceil(height / tileSize); tileY += 1) {
    for (let tileX = 0; tileX < Math.ceil(width / tileSize); tileX += 1) {
      const tileWidth = Math.min(tileSize, width - tileX * tileSize);
      const tileHeight = Math.min(tileSize, height - tileY * tileSize);
      result.push({ tile_x: tileX, tile_y: tileY, width: tileWidth, height: tileHeight, cells: Array(tileWidth * tileHeight).fill(0) });
    }
  }
  return result;
}

function legacyPayload(width = 28) {
  return {
    storageMode: 'legacy',
    width,
    height: width,
    palette: ['#101820', '#ffffff'],
    cells: Array(width * width).fill(0),
  };
}

async function createForCohort(page, { cohort, payload }) {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': 'user_pixelhunter' });
  const storage = payload.storageMode === 'tiled' ? 'tiled' : 'legacy';
  const fixtureResponse = await page.request.post('/api/__e2e/seed-cohort-template', {
    data: {
      cohort,
      storage,
      size: { width: payload.width, height: payload.height },
    },
  });
  expect(fixtureResponse.ok()).toBe(true);
  const fixture = await fixtureResponse.json();
  expect(fixture.cohort).toBe(cohort);
  expect(fixture.storage).toBe(storage);
  expect(fixture.size).toEqual({ width: payload.width, height: payload.height });
  const progressResponse = await page.request.get(`/api/colorings/${fixture.id}/progress`);
  expect(progressResponse.ok()).toBe(true);
  const progress = await progressResponse.json();
  expect(progress.specials_experiment_group).toBe(cohort);
  return { created: { id: fixture.id }, progress };
}

async function focusLegacyCell(page, index) {
  const canvas = page.locator('.coloring-canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('.coloring-canvas-viewport')).toHaveAttribute('data-interaction-disabled', 'false');
  await canvas.focus();
  await canvas.press('Home');
  const x = index % 28;
  const y = Math.floor(index / 28);
  for (let step = 0; step < x; step += 1) await canvas.press('ArrowRight');
  for (let step = 0; step < y; step += 1) await canvas.press('ArrowDown');
  await expect(canvas).toHaveAttribute('data-keyboard-cell', String(index));
  return canvas;
}

async function paintLegacyBatches(page, id, indices, revision = 0, prefix = 'legacy-e2e') {
  let nextRevision = revision;
  for (let offset = 0; offset < indices.length; offset += 64) {
    const response = await page.request.post(`/api/colorings/${id}/progress/actions`, {
      data: {
        revision: nextRevision,
        clientBatchId: `${prefix}-${offset}`,
        changes: indices.slice(offset, offset + 64).map((index) => ({ index, color: 0 })),
      },
    });
    expect(response.ok()).toBe(true);
    nextRevision = (await response.json()).revision;
  }
  return nextRevision;
}

test('Spark stays inside the tiled canvas flow and cannot be replayed', async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': 'user_pixelhunter' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });

  const { created } = await createForCohort(page, {
    cohort: 'treatment',
    title: 'Spark canvas flow',
    payload: {
      storageMode: 'tiled',
      width: 64,
      height: 64,
      tileSize: 32,
      palette: ['#101820', '#ffffff'],
      tiles: tiledPayload(64, 64),
    },
  });

  let marker;
  for (let tileY = 0; tileY < 2 && !marker; tileY += 1) {
    for (let tileX = 0; tileX < 2 && !marker; tileX += 1) {
      const response = await page.request.get(`/api/colorings/${created.id}/tiles/${tileX}/${tileY}`);
      const tile = await response.json();
      marker = tile.specials?.[0];
    }
  }
  expect(marker?.kind).toBe('spark');

  const claim = await page.request.post(`/api/colorings/${created.id}/progress/actions`, {
    data: {
      revision: 0,
      clientBatchId: 'e2e-spark-claim',
      changes: [{ index: marker.cell_index, color: 0 }],
      special_action: { type: 'claim_spark', special_id: marker.id },
    },
  });
  expect(claim.ok()).toBe(true);
  const offer = await claim.json();
  expect(offer.special_offer.target_options).toHaveLength(2);

  const use = await page.request.post(`/api/colorings/${created.id}/progress/actions`, {
    data: {
      revision: offer.revision,
      clientBatchId: 'e2e-spark-use',
      changes: [],
      special_action: {
        type: 'use_spark',
        special_id: marker.id,
        offer_token: offer.special_offer.offer_token,
        option_id: offer.special_offer.target_options[0].option_id,
      },
    },
  });
  expect(use.ok()).toBe(true);
  const applied = await use.json();
  expect(applied.special_applied_changes.length).toBe(offer.special_offer.target_options[0].estimated_cells);
  expect(applied.special_applied_changes.length).toBeLessThanOrEqual(144);

  await page.goto(`/?coloring=${created.id}`);
  await expect(page.locator('.progressive-coloring-session')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.progressive-grid-area > canvas')).toBeVisible();
  await expect(page.locator('.progressive-grid-special-offer')).toHaveCount(0);
});

test('legacy 28x28 treatment discovers Spark in the real canvas and continues', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });
  const { created, progress } = await createForCohort(page, {
    cohort: 'treatment',
    title: 'Legacy Spark treatment',
    payload: legacyPayload(),
  });
  expect(progress.specials).toHaveLength(1);
  const spark = progress.specials[0];

  await page.goto(`/?coloring=${created.id}`);
  await expect(page.locator('.coloring-session')).toHaveAttribute('data-special-cohort', 'treatment');
  const canvas = await focusLegacyCell(page, spark.cell_index);
  const claimResponse = page.waitForResponse((response) => response.url().includes(`/colorings/${created.id}/progress/actions`)
    && response.request().method() === 'POST');
  await canvas.press('Enter');
  const claimed = await (await claimResponse).json();
  expect(claimed.special_discovered).toEqual({ special_id: spark.id, kind: 'spark' });
  await expect(page.locator('.legacy-grid-special-offer')).toBeVisible();
  await expect(page.locator('[data-special-option="a"]')).toBeVisible();

  const useResponse = page.waitForResponse((response) => response.url().includes(`/colorings/${created.id}/progress/actions`)
    && response.request().method() === 'POST');
  await page.locator('[data-special-option="a"]').click();
  const used = await (await useResponse).json();
  expect(used.special_applied_changes.length).toBe(claimed.special_offer.target_options[0].estimated_cells);
  expect(used.special_applied_changes.length).toBeLessThanOrEqual(144);
  await expect(page.locator('.legacy-grid-special-offer')).toHaveCount(0);

  const afterUse = await (await page.request.get(`/api/colorings/${created.id}/progress`)).json();
  const nextIndex = afterUse.filled.findIndex((color) => color === -1);
  expect(nextIndex).toBeGreaterThanOrEqual(0);
  const continueCanvas = await focusLegacyCell(page, nextIndex);
  const continueResponse = page.waitForResponse((response) => response.url().includes(`/colorings/${created.id}/progress/actions`)
    && response.request().method() === 'POST');
  await continueCanvas.press('Enter');
  expect((await (await continueResponse).json()).revision).toBeGreaterThan(used.revision);
});

test('legacy 28x28 control has no Spark marker, action, or HUD', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });
  const { created, progress } = await createForCohort(page, {
    cohort: 'control',
    title: 'Legacy Spark control',
    payload: legacyPayload(),
  });
  expect(progress.specials).toEqual([]);
  await page.goto(`/?coloring=${created.id}`);
  await expect(page.locator('.coloring-session')).toHaveAttribute('data-special-cohort', 'control');
  const canvas = await focusLegacyCell(page, 435);
  const responsePromise = page.waitForResponse((response) => response.url().includes(`/colorings/${created.id}/progress/actions`)
    && response.request().method() === 'POST');
  await canvas.press('Enter');
  const response = await (await responsePromise).json();
  expect(response.special_discovered).toBeNull();
  await expect(page.locator('.legacy-grid-special-offer')).toHaveCount(0);
});

test('legacy 28x28 last-cell Spark preserves discovery and completion', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });
  const { created, progress } = await createForCohort(page, {
    cohort: 'treatment',
    title: 'Legacy Spark last cell',
    payload: legacyPayload(),
  });
  const spark = progress.specials[0];
  const other = Array.from({ length: 28 * 28 }, (_, index) => index).filter((index) => index !== spark.cell_index);
  await paintLegacyBatches(page, created.id, other, 0, 'legacy-last-cell');

  await page.goto(`/?coloring=${created.id}`);
  const canvas = await focusLegacyCell(page, spark.cell_index);
  const finalResponse = page.waitForResponse((response) => response.url().includes(`/colorings/${created.id}/progress/actions`)
    && response.request().method() === 'POST');
  await canvas.press('Enter');
  const completed = await (await finalResponse).json();
  expect(completed.special_discovered).toEqual({ special_id: spark.id, kind: 'spark' });
  expect(completed.percent).toBe(100);
  expect(completed.completed_at).toBeTruthy();
  expect(completed.artwork_id).toBeTruthy();
  await expect(page.locator('[data-special-discovered]')).toBeAttached();
  await expect(page.locator('.completion-dialog')).toBeVisible();
});

test('legacy Artifact progress remains visible after a real /progress reload', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });
  const fixture = await createForCohort(page, {
    cohort: 'treatment',
    title: 'Legacy Artifact reload',
    payload: legacyPayload(160),
  });
  const artifact = fixture.progress.specials.find((special) => special.kind === 'artifact');
  expect(artifact, 'legacy 160 deterministic fixture must contain an Artifact marker').toBeTruthy();
  const claim = await page.request.post(`/api/colorings/${fixture.created.id}/progress/actions`, {
    data: {
      revision: fixture.progress.revision,
      clientBatchId: 'legacy-artifact-reload-claim',
      changes: [{ index: fixture.artifact.cell_index, color: 0 }],
      special_action: { type: 'claim_artifact', special_id: fixture.artifact.id },
    },
  });
  expect(claim.ok()).toBe(true);
  const claimed = await claim.json();
  expect(claimed.artifact_progress.fragments).toBe(1);
  const artifactTotal = String(claimed.artifact_progress.total);

  await page.goto(`/?coloring=${fixture.created.id}`);
  await expect(page.locator('.coloring-session')).toHaveAttribute('data-special-cohort', 'treatment');
  await expect(page.locator('[data-artifact-progress]')).toHaveAttribute('data-artifact-fragments', '1');
  await expect(page.locator('[data-artifact-progress]')).toHaveAttribute('data-artifact-total', artifactTotal);
});
