import { test, expect } from '@playwright/test';

const GRID = 64;

async function seedFixture(page, cohort = 'treatment', size = { width: GRID, height: GRID }) {
  const seeded = await page.request.post('/api/__e2e/seed-cohort-template', {
    data: { cohort, storage: 'tiled', size },
  });
  expect(seeded.ok()).toBe(true);
  return seeded.json();
}

async function findSpecial(page, id, kind, size = { width: GRID, height: GRID }) {
  for (let tileY = 0; tileY < Math.ceil(Number(size.height) / 32); tileY += 1) {
    for (let tileX = 0; tileX < Math.ceil(Number(size.width) / 32); tileX += 1) {
      const response = await page.request.get(`/api/colorings/${id}/tiles/${tileX}/${tileY}`);
      expect(response.ok()).toBe(true);
      const tile = await response.json();
      const special = (tile.specials || []).find((candidate) => (
        candidate.kind === kind && candidate.state === 'unseen'
      ));
      if (special) return special;
    }
  }
  return null;
}

test('Phase 2 automatic Spark resolves one bounded default target without a choice modal', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(testInfo.project.name.toLowerCase().includes('webkit'), 'Canvas delivery verifier targets Chromium/WebView-like projects');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });
  const userId = `e2e_phase2_spark_auto_${testInfo.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': userId });
  const fixture = await seedFixture(page);
  const spark = await findSpecial(page, fixture.id, 'spark', fixture.size);
  expect(spark).toBeTruthy();

  const claimed = await page.request.post(`/api/colorings/${fixture.id}/progress/actions`, {
    data: {
      revision: 0,
      clientBatchId: 'phase2-e2e-spark-auto-claim',
      changes: [{ index: spark.cell_index, color: 0 }],
      special_action: { type: 'claim_spark', special_id: spark.id, session_game: true },
    },
  });
  expect(claimed.ok()).toBe(true);
  const offer = await claimed.json();
  expect(offer.special_offer.target_options.length).toBeGreaterThan(0);
  expect(offer.special_offer.auto_apply).toBe(false);

  const useResponse = page.waitForResponse((response) => response.url().includes(`/api/colorings/${fixture.id}/progress/actions`)
    && response.request().method() === 'POST'
    && response.request().postDataJSON()?.special_action?.type === 'use_spark');
  await page.goto(`/?coloring=${fixture.id}&phase2=session&phase2Variant=treatment&phase2Event=spark_auto&phase2Subject=phase2_${testInfo.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`);
  const used = await (await useResponse).json();
  expect(used.special_applied_changes.length).toBeGreaterThan(0);
  await expect(page.locator('[data-session-game-spark-auto]')).toHaveCount(0);
  await expect(page.locator('[data-special-wave-kind="spark_auto"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-session-game-next-beat]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-phase2-spark-option]')).toHaveCount(0);
  await expect(page.locator('[data-special-kind="bomb"], [data-special-kind="fuse"], [data-special-kind="choice"], [data-special-kind="hazard"]')).toHaveCount(0);
});

test('Phase 2 Bomb keeps one spatial action and produces a bounded area reveal', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(testInfo.project.name.toLowerCase().includes('webkit'), 'Canvas delivery verifier targets Chromium/WebView-like projects');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });
  const userId = `e2e_phase2_bomb_${testInfo.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': userId });
  const fixture = await seedFixture(page, 'treatment', { width: 160, height: 160 });
  const bomb = await findSpecial(page, fixture.id, 'bomb', fixture.size);
  expect(bomb).toBeTruthy();

  const claimed = await page.request.post(`/api/colorings/${fixture.id}/progress/actions`, {
    data: {
      revision: 0,
      clientBatchId: 'phase2-e2e-bomb-claim',
      changes: [{ index: bomb.cell_index, color: 0 }],
      special_action: { type: 'claim_bomb', special_id: bomb.id, session_game: true },
    },
  });
  expect(claimed.ok()).toBe(true);
  const offer = await claimed.json();
  expect(offer.special_offer.kind).toBe('bomb');
  expect(offer.special_offer.radius).toBeGreaterThan(0);

  const useResponse = page.waitForResponse((response) => response.url().includes(`/api/colorings/${fixture.id}/progress/actions`)
    && response.request().method() === 'POST'
    && response.request().postDataJSON()?.special_action?.type === 'use_bomb');
  await page.goto(`/?coloring=${fixture.id}&phase2=session&phase2Variant=treatment&phase2Event=bomb&phase2Subject=phase2_${testInfo.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`);
  await expect(page.locator('[data-phase2-bomb]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-phase2-bomb-use]')).toHaveCount(1);
  await expect(page.locator('[data-bomb-center-direction]')).toHaveCount(0);
  await page.locator('[data-phase2-bomb-use]').click();
  const used = await (await useResponse).json();
  expect(used.special_applied_changes.length).toBeGreaterThan(0);
  await expect(page.locator('[data-special-wave-kind="bomb"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-session-game-next-beat]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-special-kind="spark"], [data-special-kind="fuse"], [data-special-kind="choice"], [data-special-kind="hazard"]')).toHaveCount(0);
});
