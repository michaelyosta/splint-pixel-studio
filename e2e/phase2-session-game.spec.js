import { test, expect } from '@playwright/test';

const GRID = 64;

test('Phase 2 treatment keeps Spark manual and pauses after the authored reveal beat', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(testInfo.project.name.toLowerCase().includes('webkit'), 'Canvas delivery verifier targets Chromium/WebView-like projects');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });

  const userId = `e2e_phase2_${testInfo.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': userId });
  const seeded = await page.request.post('/api/__e2e/seed-cohort-template', {
    data: { cohort: 'treatment', storage: 'tiled', size: { width: GRID, height: GRID } },
  });
  expect(seeded.ok()).toBe(true);
  const fixture = await seeded.json();
  const progress = await (await page.request.get(`/api/colorings/${fixture.id}/progress`)).json();
  expect(progress.specials_experiment_group).toBe('treatment');

  let spark = null;
  for (let tileY = 0; tileY < 2 && !spark; tileY += 1) {
    for (let tileX = 0; tileX < 2 && !spark; tileX += 1) {
      const tile = await (await page.request.get(`/api/colorings/${fixture.id}/tiles/${tileX}/${tileY}`)).json();
      spark = (tile.specials || []).find((candidate) => candidate.kind === 'spark' && candidate.state === 'unseen');
    }
  }
  expect(spark).toBeTruthy();

  const claimed = await page.request.post(`/api/colorings/${fixture.id}/progress/actions`, {
    data: {
      revision: 0,
      clientBatchId: 'phase2-e2e-claim',
      changes: [{ index: spark.cell_index, color: 0 }],
      special_action: { type: 'claim_spark', special_id: spark.id, session_game: true },
    },
  });
  expect(claimed.ok()).toBe(true);
  const offer = await claimed.json();
  expect(offer.special_offer.target_options).toHaveLength(2);
  expect(offer.special_offer.auto_apply).toBe(false);

  await page.goto(`/?coloring=${fixture.id}&phase2=session&phase2Variant=treatment&phase2Subject=phase2_${testInfo.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`);
  await expect(page.locator('[data-session-game-spark]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-phase2-spark-option]')).toHaveCount(2);
  await expect(page.locator('[data-special-kind="bomb"], [data-special-kind="fuse"], [data-special-kind="choice"], [data-special-kind="hazard"]')).toHaveCount(0);
  await expect(page.locator('[data-special-wave]')).toHaveCount(0);

  const useResponse = page.waitForResponse((response) => response.url().includes(`/api/colorings/${fixture.id}/progress/actions`)
    && response.request().method() === 'POST'
    && response.request().postDataJSON()?.special_action?.type === 'use_spark');
  await page.locator('[data-phase2-spark-option="nearby"]').click();
  const used = await (await useResponse).json();
  expect(used.special_applied_changes.length).toBe(offer.special_offer.target_options[1].estimated_cells);
  await expect(page.locator('[data-special-wave]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-session-game-next-beat]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-session-game-next-beat] [data-session-game-continue]')).toBeVisible();
});
