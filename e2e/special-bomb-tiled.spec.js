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
      const bomb = (tile.specials || []).find((special) => (
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

  // Bomb remains an experiment-only challenger, so opt into its explicit
  // treatment instead of relying on the product's spark_choice baseline.
  await page.goto(`/?coloring=${created.id}&phase2Event=bomb`);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toBeVisible({ timeout: 15000 });
  await expect(session).toHaveAttribute('data-special-treatment', 'treatment', { timeout: 15000 });
  await expect(page.locator('.progressive-grid-area > canvas')).toBeVisible({ timeout: 15000 });

  const canvas = page.locator('.progressive-grid-area > canvas');
  await canvas.focus();
  await canvas.press('Home');
  const x = Number(bomb.cell_index) % GRID;
  const y = Math.floor(Number(bomb.cell_index) / GRID);
  for (let step = 0; step < x; step += 1) await canvas.press('ArrowRight');
  for (let step = 0; step < y; step += 1) await canvas.press('ArrowDown');
  await expect(canvas).toHaveAttribute('data-keyboard-cell', String(bomb.cell_index));

  const claimPromise = page.waitForResponse((response) => {
    if (!response.url().includes(`/colorings/${created.id}/progress/actions`)
      || response.request().method() !== 'POST') return false;
    try {
      return response.request().postDataJSON()?.special_action?.type === 'claim_bomb';
    } catch {
      return false;
    }
  }, { timeout: 15000 });
  // If the tile is already resident the stroke commits immediately; otherwise
  // the first Enter preloads it and the client auto-commits the queued paint.
  await canvas.press('Enter');
  const claim = await claimPromise;
  expect(claim.status()).toBe(200);
  const claimed = await claim.json();
  expect(claimed.special_discovered).toEqual({ special_id: bomb.id, kind: 'bomb' });
  expect(claimed.special_offer.kind).toBe('bomb');
  expect(claimed.special_offer.target_options).toBeUndefined();
  expect(Number(claimed.special_offer.radius)).toBeGreaterThanOrEqual(1);

  const offer = page.locator('.progressive-grid-special-offer[data-special-kind="bomb"]');
  await expect(offer).toBeVisible({ timeout: 15000 });
  await expect(offer).toHaveAttribute('data-special-supported', 'true');
  await expect(offer.locator('[data-bomb-center-label]')).toBeVisible();

  const initialCenter = {
    x: Number(await offer.getAttribute('data-bomb-center-x')),
    y: Number(await offer.getAttribute('data-bomb-center-y')),
  };
  expect(Number.isFinite(initialCenter.x)).toBe(true);
  expect(Number.isFinite(initialCenter.y)).toBe(true);

  await offer.locator('[data-bomb-center-direction="up"]').click();
  const nudgedCenter = {
    x: Number(await offer.getAttribute('data-bomb-center-x')),
    y: Number(await offer.getAttribute('data-bomb-center-y')),
  };
  expect(nudgedCenter.y).toBe(initialCenter.y - 1);
  await offer.locator('[data-bomb-center-direction="reset"]').click();
  expect(Number(await offer.getAttribute('data-bomb-center-y'))).toBe(initialCenter.y);

  const usePromise = page.waitForResponse((response) => {
    if (!response.url().includes(`/colorings/${created.id}/progress/actions`)
      || response.request().method() !== 'POST') return false;
    try {
      return response.request().postDataJSON()?.special_action?.type === 'use_bomb';
    } catch {
      return false;
    }
  }, { timeout: 15000 });
  await offer.locator('[data-bomb-use]').click();
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
