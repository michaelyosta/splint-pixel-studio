import { test, expect } from '@playwright/test';

const GRID = 160;
const TILE = 32;

async function createTreatment(page) {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': 'user_bomb_e2e' });
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

async function findBomb(page, id) {
  for (let tileY = 0; tileY < Math.ceil(GRID / TILE); tileY += 1) {
    for (let tileX = 0; tileX < Math.ceil(GRID / TILE); tileX += 1) {
      const response = await page.request.get(`/api/colorings/${id}/tiles/${tileX}/${tileY}`);
      expect(response.ok()).toBe(true);
      const tile = await response.json();
      // The browser deliberately bounds each resident tile to the first eight
      // server-ordered markers; choose a Bomb that the real client can see.
      const bomb = (tile.specials || []).slice(0, 8).find((special) => (
        special.kind === 'bomb'
        && special.state === 'unseen'
      ));
      if (bomb) return bomb;
    }
  }
  throw new Error('Fixture has no Bomb marker');
}

test('tiled Bomb claim, compact center offer, and use flow on 390x844', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'tiled Bomb UI verifier targets chromium pointer/keyboard behavior');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });

  const { created } = await createTreatment(page);
  const bomb = await findBomb(page, created.id);
  expect(bomb.cell_index).toBeGreaterThanOrEqual(0);
  expect(bomb.cell_index).toBeLessThan(GRID * GRID);

  // The current Phase 2 contract hides Specials until the first manual reveal.
  // Seed the server-authoritative Bomb offer, then verify its UI resolution.
  const claimResponse = await page.request.post(`/api/colorings/${created.id}/progress/actions`, {
    data: {
      revision: 0,
      clientBatchId: 'alpha-rc-bomb-tiled-claim',
      changes: [{ index: bomb.cell_index, color: 0 }],
      special_action: { type: 'claim_bomb', special_id: bomb.id, session_game: true },
    },
  });
  expect(claimResponse.ok()).toBe(true);
  const claimed = await claimResponse.json();
  expect(claimed.special_discovered).toEqual({ special_id: bomb.id, kind: 'bomb' });
  expect(claimed.special_offer.kind).toBe('bomb');
  expect(claimed.special_offer.target_options).toBeUndefined();
  expect(Number(claimed.special_offer.radius)).toBeGreaterThanOrEqual(1);

  // Bomb remains an experiment-only challenger, so opt into its explicit
  // treatment instead of relying on the product's spark_choice baseline.
  // Opt into the explicit Phase 2 session treatment; `phase2Event` alone is
  // ignored by the production route and leaves the default Spark contract.
  await page.goto(`/?splintMetrics=1&coloring=${created.id}&phase2=session&phase2Variant=treatment&phase2Event=bomb&phase2Subject=phase2_bomb_tiled`);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toBeVisible({ timeout: 15000 });
  await expect(session).toHaveAttribute('data-special-treatment', 'treatment', { timeout: 15000 });
  await expect(page.locator('.progressive-grid-area > canvas')).toBeVisible({ timeout: 15000 });

  const offer = page.locator('.progressive-grid-special-offer[data-special-kind="bomb"]');
  await expect(offer).toBeVisible({ timeout: 15000 });
  await expect(offer).toHaveAttribute('data-special-supported', 'true');
  await expect(offer.locator('.progressive-grid-special-detail')).toContainText('радиус');
  await expect(offer.locator('[data-bomb-center-direction]')).toHaveCount(0);

  const usePromise = page.waitForResponse((response) => {
    if (!response.url().includes(`/colorings/${created.id}/progress/actions`)
      || response.request().method() !== 'POST') return false;
    try {
      return response.request().postDataJSON()?.special_action?.type === 'use_bomb';
    } catch {
      return false;
    }
  }, { timeout: 15000 });
  await offer.locator('[data-phase2-bomb-use]').click();
  const use = await usePromise;
  expect(use.status()).toBe(200);
  const used = await use.json();
  expect(used.special_applied_changes.length).toBeGreaterThan(0);
  expect(used.special_applied_changes.length).toBeLessThanOrEqual(32);
  for (const change of used.special_applied_changes) {
    expect(change.color).toBe(0);
  }
  await expect(page.locator('.progressive-grid-special-offer')).toHaveCount(0, { timeout: 15000 });
});
