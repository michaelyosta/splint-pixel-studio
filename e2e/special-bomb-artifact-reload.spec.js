import { test, expect } from '@playwright/test';

const GRID = 160;
const TILE = 32;

async function createTreatment(page, userId) {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': userId });
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

async function findKind(page, id, kind) {
  for (let tileY = 0; tileY < Math.ceil(GRID / TILE); tileY += 1) {
    for (let tileX = 0; tileX < Math.ceil(GRID / TILE); tileX += 1) {
      const response = await page.request.get(`/api/colorings/${id}/tiles/${tileX}/${tileY}`);
      expect(response.ok()).toBe(true);
      const tile = await response.json();
      const special = (tile.specials || []).find((candidate) => (
        candidate.kind === kind && candidate.state === 'unseen'
      ));
      if (special) return special;
    }
  }
  throw new Error(`Fixture has no ${kind} marker`);
}

test('Bomb offer reloads with the server-provided default center and applies without a resident tile', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'reload verifier targets the Chromium contract');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });

  const { created } = await createTreatment(page, 'user_bomb_reload_regression');
  const bomb = await findKind(page, created.id, 'bomb');
  const claimedResponse = await page.request.post(`/api/colorings/${created.id}/progress/actions`, {
    data: {
      revision: 0,
      clientBatchId: 'e2e-bomb-reload-claim',
      changes: [{ index: bomb.cell_index, color: 0 }],
      special_action: { type: 'claim_bomb', special_id: bomb.id },
    },
  });
  expect(claimedResponse.ok()).toBe(true);
  const claimed = await claimedResponse.json();
  const center = {
    x: Number(claimed.special_offer.center_x),
    y: Number(claimed.special_offer.center_y),
  };
  expect(center.x).toBe(Number(bomb.cell_index) % GRID);
  expect(center.y).toBe(Math.floor(Number(bomb.cell_index) / GRID));

  await page.goto(`/?coloring=${created.id}`);
  const offer = page.locator('.progressive-grid-special-offer[data-special-kind="bomb"]');
  await expect(offer).toBeVisible({ timeout: 20000 });
  await expect(offer).toHaveAttribute('data-bomb-center-x', String(center.x));
  await expect(offer).toHaveAttribute('data-bomb-center-y', String(center.y));

  const usePromise = page.waitForResponse((response) => {
    if (!response.url().includes(`/colorings/${created.id}/progress/actions`)
      || response.request().method() !== 'POST') return false;
    try {
      return response.request().postDataJSON()?.special_action?.type === 'use_bomb';
    } catch {
      return false;
    }
  }, { timeout: 20000 });
  await offer.locator('[data-bomb-use]').click();
  const used = await (await usePromise).json();
  expect(used.special_applied_changes.length).toBeGreaterThan(0);
  expect(used.special_applied_changes.length).toBeLessThanOrEqual(32);
});

test('Artifact fragment progress renders persistently after /progress reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });

  const { created } = await createTreatment(page, 'user_artifact_reload_regression');
  const artifact = await findKind(page, created.id, 'artifact');
  const claimedResponse = await page.request.post(`/api/colorings/${created.id}/progress/actions`, {
    data: {
      revision: 0,
      clientBatchId: 'e2e-artifact-reload-claim',
      changes: [{ index: artifact.cell_index, color: 0 }],
      special_action: { type: 'claim_artifact', special_id: artifact.id },
    },
  });
  expect(claimedResponse.ok()).toBe(true);
  const claimed = await claimedResponse.json();
  expect(claimed.artifact_progress.fragments).toBe(1);

  await page.goto(`/?coloring=${created.id}`);
  await expect(page.locator('.progressive-coloring-session')).toBeVisible({ timeout: 20000 });
  const chip = page.locator('[data-artifact-progress]');
  await expect(chip).toBeVisible({ timeout: 20000 });
  await expect(chip).toContainText('1/3');

  await page.reload();
  await expect(page.locator('.progressive-coloring-session')).toBeVisible({ timeout: 20000 });
  await expect(chip).toBeVisible({ timeout: 20000 });
  await expect(chip).toContainText('1/3');
});
