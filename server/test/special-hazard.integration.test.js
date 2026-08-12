import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

const serverCwd = basename(process.cwd()).toLowerCase() === 'server' ? process.cwd() : join(process.cwd(), 'server');
let portOffset = 0;

function createClient(baseUrl, userId) {
  return async (path, { method = 'GET', body } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { response, json: await response.json().catch(() => ({})) };
  };
}

function tiledPayload(width, height, tileSize = 32) {
  const tiles = [];
  for (let tileY = 0; tileY < Math.ceil(height / tileSize); tileY += 1) {
    for (let tileX = 0; tileX < Math.ceil(width / tileSize); tileX += 1) {
      const tileWidth = Math.min(tileSize, width - tileX * tileSize);
      const tileHeight = Math.min(tileSize, height - tileY * tileSize);
      tiles.push({
        tile_x: tileX,
        tile_y: tileY,
        width: tileWidth,
        height: tileHeight,
        cells: Array(tileWidth * tileHeight).fill(0),
      });
    }
  }
  return tiles;
}

async function startServer(t, userId) {
  const directory = await mkdtemp(join(tmpdir(), 'splint-hazard-'));
  const port = 32400 + (process.pid % 300) + portOffset;
  portOffset += 1;
  const child = spawn('node', ['index.js'], {
    cwd: serverCwd,
    env: {
      ...process.env,
      DATABASE_URL: '',
      PORT: String(port),
      SQLITE_DB_PATH: join(directory, 'test.db.bin'),
      MEDIA_STORAGE_ROOT: join(directory, 'uploads'),
      NODE_ENV: 'test',
      ALLOW_DEV_AUTH: 'true',
      SPECIAL_CELLS_COHORT: 'SPECIALS_TREATMENT',
      SPECIAL_CELLS_QA_OVERRIDE: 'true',
      SPECIAL_CELLS_QA_USER_ID: 'hazard_integration_user,hazard_skip_user,hazard_legacy_user,hazard_legacy_28_user,hazard_completion_user,hazard_disarm_completion_user',
      SPECIAL_CELLS_DIAGNOSTICS: 'true',
      RATE_LIMIT_MAX: '10000',
      RENDER_OUTBOX_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode == null) child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Hazard server did not start: ${stderr}`)), 60_000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Hazard server exited before start (${code}): ${stderr}`)));
  });
  return createClient(`http://127.0.0.1:${port}`, userId);
}

async function createTemplate(request, title = 'Hazard integration') {
  const created = await request('/colorings/create', {
    method: 'POST',
    body: {
      title,
      storageMode: 'tiled',
      width: 160,
      height: 160,
      tileSize: 32,
      palette: ['#101820', '#ffffff'],
      tiles: tiledPayload(160, 160),
    },
  });
  assert.equal(created.response.status, 201);
  return created.json.id;
}

function legacyCells(width, height) {
  return Array(width * height).fill(0);
}

async function createLegacyTemplate(request, title = 'Legacy Hazard integration', width = 160, height = 160) {
  const created = await request('/colorings/create', {
    method: 'POST',
    body: {
      title,
      storageMode: 'legacy',
      width,
      height,
      palette: ['#101820', '#ffffff'],
      cells: legacyCells(width, height),
    },
  });
  assert.equal(created.response.status, 201);
  return created.json.id;
}

async function findLegacyHazard(request, templateId) {
  const progress = await request(`/colorings/${templateId}/progress`);
  assert.equal(progress.response.status, 200);
  return (progress.json.specials || []).find((special) => (
    special.kind === 'hazard' && special.state === 'unseen'
  )) || null;
}

async function findHazard(request, templateId) {
  for (let tileY = 0; tileY < 5; tileY += 1) {
    for (let tileX = 0; tileX < 5; tileX += 1) {
      const tile = await request(`/colorings/${templateId}/tiles/${tileX}/${tileY}`);
      assert.equal(tile.response.status, 200);
      const hazard = (tile.json.specials || []).find((special) => (
        special.kind === 'hazard' && special.state === 'unseen'
      ));
      if (hazard) return hazard;
    }
  }
  return null;
}

function claimBody(hazard, clientBatchId = 'hazard-claim-001') {
  return {
    revision: 0,
    clientBatchId,
    changes: [{ index: hazard.cell_index, color: 0 }],
    special_action: { type: 'claim_hazard', special_id: hazard.id },
  };
}

test('Hazard claim/disarm is server-derived, bounded, reload-safe, and idempotent', async (t) => {
  const request = await startServer(t, 'hazard_integration_user');
  const templateId = await createTemplate(request);
  const hazard = await findHazard(request, templateId);
  assert.ok(hazard, 'treatment tiled template exposes a Hazard marker');

  const claimed = await request(`/colorings/${templateId}/progress/actions`, {
    method: 'POST', body: claimBody(hazard),
  });
  assert.equal(claimed.response.status, 200);
  assert.deepEqual(claimed.json.special_discovered, { special_id: hazard.id, kind: 'hazard' });
  assert.equal(claimed.json.special_offer.kind, 'hazard');
  assert.ok(claimed.json.special_offer.reward_cells > 0);
  assert.ok(claimed.json.special_offer.reward_cells <= 16);
  assert.equal(claimed.json.special_offer.penalty.progress_deleted, 0);

  const replayClaim = await request(`/colorings/${templateId}/progress/actions`, {
    method: 'POST', body: claimBody(hazard),
  });
  assert.equal(replayClaim.response.status, 200);
  assert.equal(replayClaim.json.idempotent, true);
  assert.deepEqual(replayClaim.json.special_offer, claimed.json.special_offer);

  const reloaded = await request(`/colorings/${templateId}/progress`);
  assert.equal(reloaded.response.status, 200);
  assert.equal(reloaded.json.special_offer.kind, 'hazard');
  assert.equal(reloaded.json.special_offer.offer_token, claimed.json.special_offer.offer_token);

  const stale = await request(`/colorings/${templateId}/progress/actions`, {
    method: 'POST',
    body: {
      revision: claimed.json.revision - 1,
      clientBatchId: 'hazard-stale-revision',
      changes: [],
      special_action: {
        type: 'disarm_hazard', special_id: hazard.id, offer_token: claimed.json.special_offer.offer_token,
      },
    },
  });
  assert.equal(stale.response.status, 409);

  const disarmed = await request(`/colorings/${templateId}/progress/actions`, {
    method: 'POST',
    body: {
      revision: claimed.json.revision,
      clientBatchId: 'hazard-disarm-001',
      changes: [],
      special_action: {
        type: 'disarm_hazard', special_id: hazard.id, offer_token: claimed.json.special_offer.offer_token,
      },
    },
  });
  assert.equal(disarmed.response.status, 200);
  assert.ok(disarmed.json.special_applied_changes.length > 0);
  assert.ok(disarmed.json.special_applied_changes.length <= 16);
  assert.ok(disarmed.json.special_applied_changes.every((change) => change.color === 0));

  const replayUse = await request(`/colorings/${templateId}/progress/actions`, {
    method: 'POST',
    body: {
      revision: claimed.json.revision,
      clientBatchId: 'hazard-disarm-001',
      changes: [],
      special_action: {
        type: 'disarm_hazard', special_id: hazard.id, offer_token: claimed.json.special_offer.offer_token,
      },
    },
  });
  assert.equal(replayUse.response.status, 200);
  assert.equal(replayUse.json.idempotent, true);
  assert.deepEqual(replayUse.json.special_applied_changes, disarmed.json.special_applied_changes);

  const duplicateUse = await request(`/colorings/${templateId}/progress/actions`, {
    method: 'POST',
    body: {
      revision: disarmed.json.revision,
      clientBatchId: 'hazard-disarm-duplicate',
      changes: [],
      special_action: {
        type: 'disarm_hazard', special_id: hazard.id, offer_token: claimed.json.special_offer.offer_token,
      },
    },
  });
  assert.equal(duplicateUse.response.status, 409);
  assert.equal(duplicateUse.json.code, 'SPECIAL_OFFER_STALE');
});

test('Hazard skip is a non-destructive local penalty and concurrent resolution spends once', async (t) => {
  const request = await startServer(t, 'hazard_skip_user');
  const templateId = await createTemplate(request, 'Hazard skip integration');
  const hazard = await findHazard(request, templateId);
  assert.ok(hazard);
  const claimed = await request(`/colorings/${templateId}/progress/actions`, {
    method: 'POST', body: claimBody(hazard, 'hazard-skip-claim'),
  });
  assert.equal(claimed.response.status, 200);

  const skipped = await request(`/colorings/${templateId}/progress/actions`, {
    method: 'POST',
    body: {
      revision: claimed.json.revision,
      clientBatchId: 'hazard-skip-001',
      changes: [],
      special_action: { type: 'skip_hazard', special_id: hazard.id, offer_token: claimed.json.special_offer.offer_token },
    },
  });
  assert.equal(skipped.response.status, 200);
  assert.equal(skipped.json.special_discovered.missed, true);
  assert.equal(skipped.json.special_discovered.temporary_penalty.progress_deleted, 0);
  assert.equal(skipped.json.special_applied_changes.length, 0);

  const secondTemplate = await createTemplate(request, 'Hazard concurrency integration');
  const secondHazard = await findHazard(request, secondTemplate);
  const secondClaim = await request(`/colorings/${secondTemplate}/progress/actions`, {
    method: 'POST', body: claimBody(secondHazard, 'hazard-concurrent-claim'),
  });
  const body = (clientBatchId) => ({
    revision: secondClaim.json.revision,
    clientBatchId,
    changes: [],
    special_action: {
      type: 'disarm_hazard', special_id: secondHazard.id, offer_token: secondClaim.json.special_offer.offer_token,
    },
  });
  const [left, right] = await Promise.all([
    request(`/colorings/${secondTemplate}/progress/actions`, { method: 'POST', body: body('hazard-concurrent-a') }),
    request(`/colorings/${secondTemplate}/progress/actions`, { method: 'POST', body: body('hazard-concurrent-b') }),
  ]);
  const statuses = [left.response.status, right.response.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const winner = left.response.status === 200 ? left : right;
  assert.ok(winner.json.special_applied_changes.length > 0);
  assert.ok(winner.json.special_applied_changes.length <= 16);
});

test('legacy treatment creates, reloads, and resolves a deterministic Hazard', async (t) => {
  const request = await startServer(t, 'hazard_legacy_user');
  const templateId = await createLegacyTemplate(request);
  const hazard = await findLegacyHazard(request, templateId);
  assert.ok(hazard, 'legacy treatment template exposes a Hazard marker');

  const claimed = await request(`/colorings/${templateId}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'legacy-hazard-claim-001',
      changes: [{ index: hazard.cell_index, color: 0 }],
      special_action: { type: 'claim_hazard', special_id: hazard.id },
    },
  });
  assert.equal(claimed.response.status, 200);
  assert.deepEqual(claimed.json.special_discovered, { special_id: hazard.id, kind: 'hazard' });
  assert.equal(claimed.json.special_offer.kind, 'hazard');
  assert.ok(claimed.json.special_offer.reward_cells > 0);
  assert.ok(claimed.json.special_offer.reward_cells <= 16);

  const claimReplay = await request(`/colorings/${templateId}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'legacy-hazard-claim-001',
      changes: [{ index: hazard.cell_index, color: 0 }],
      special_action: { type: 'claim_hazard', special_id: hazard.id },
    },
  });
  assert.equal(claimReplay.response.status, 200);
  assert.equal(claimReplay.json.idempotent, true);
  assert.equal(claimReplay.json.special_offer.offer_token, claimed.json.special_offer.offer_token);

  const reloaded = await request(`/colorings/${templateId}/progress`);
  assert.equal(reloaded.response.status, 200);
  assert.equal(reloaded.json.special_offer.kind, 'hazard');
  assert.equal(reloaded.json.special_offer.offer_token, claimed.json.special_offer.offer_token);

  const disarmed = await request(`/colorings/${templateId}/progress/actions`, {
    method: 'POST',
    body: {
      revision: reloaded.json.revision,
      clientBatchId: 'legacy-hazard-disarm-001',
      changes: [],
      special_action: {
        type: 'disarm_hazard',
        special_id: hazard.id,
        offer_token: reloaded.json.special_offer.offer_token,
      },
    },
  });
  assert.equal(disarmed.response.status, 200);
  assert.ok(disarmed.json.special_applied_changes.length > 0);
  assert.ok(disarmed.json.special_applied_changes.length <= 16);

  const duplicate = await request(`/colorings/${templateId}/progress/actions`, {
    method: 'POST',
    body: {
      revision: disarmed.json.revision,
      clientBatchId: 'legacy-hazard-disarm-duplicate',
      changes: [],
      special_action: {
        type: 'disarm_hazard',
        special_id: hazard.id,
        offer_token: reloaded.json.special_offer.offer_token,
      },
    },
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.json.code, 'SPECIAL_OFFER_STALE');
});

test('legacy 28x28 fixture remains Spark-only after Hazard placement', async (t) => {
  const request = await startServer(t, 'hazard_legacy_28_user');
  const templateId = await createLegacyTemplate(request, 'Legacy 28x28 fixture', 28, 28);
  const progress = await request(`/colorings/${templateId}/progress`);
  assert.equal(progress.response.status, 200);
  assert.equal(progress.json.specials.length, 1);
  assert.equal(progress.json.specials[0].kind, 'spark');
  assert.equal(progress.json.specials.some((special) => special.kind === 'hazard'), false);
});

test('Hazard disarm can be the last-cell completion without losing progress', async (t) => {
  const request = await startServer(t, 'hazard_completion_user');
  const templateId = await createTemplate(request, 'Hazard completion integration');
  const hazard = await findHazard(request, templateId);
  assert.ok(hazard);

  const exclude = new Set([hazard.cell_index]);
  const indices = [];
  for (let index = 0; index < 160 * 160; index += 1) {
    if (!exclude.has(index)) indices.push(index);
  }
  let revision = 0;
  for (let offset = 0; offset < indices.length; offset += 64) {
    const saved = await request(`/colorings/${templateId}/progress/actions`, {
      method: 'POST',
      body: {
        revision,
        clientBatchId: `hazard-completion-prepaint-${offset}`,
        changes: indices.slice(offset, offset + 64).map((index) => ({ index, color: 0 })),
      },
    });
    assert.equal(saved.response.status, 200);
    revision = Number(saved.json.revision);
  }

  const claimed = await request(`/colorings/${templateId}/progress/actions`, {
    method: 'POST',
    body: {
      revision,
      clientBatchId: 'hazard-completion-claim',
      changes: [{ index: hazard.cell_index, color: 0 }],
      special_action: { type: 'claim_hazard', special_id: hazard.id },
    },
  });
  assert.equal(claimed.response.status, 200);
  assert.equal(claimed.json.completed_cells, 160 * 160);
  assert.equal(claimed.json.special_offer, null, 'a completing claim cannot leave an uncloseable offer');

  const progress = await request(`/colorings/${templateId}/progress`);
  assert.equal(progress.response.status, 200);
  assert.equal(progress.json.completed_cells, 160 * 160);
  assert.equal(progress.json.percent, 100);
  assert.ok(progress.json.completed_at);
});

test('Hazard disarm, not only claim, can complete the final reserved reward window', async (t) => {
  const request = await startServer(t, 'hazard_disarm_completion_user');
  const templateId = await createTemplate(request, 'Hazard disarm completion integration');
  const hazard = await findHazard(request, templateId);
  assert.ok(hazard);

  const width = 160;
  const height = 160;
  const anchorX = hazard.cell_index % width;
  const anchorY = Math.floor(hazard.cell_index / width);
  const rewardIndices = [];
  for (let y = Math.max(0, anchorY - 3); y <= Math.min(height - 1, anchorY + 3); y += 1) {
    for (let x = Math.max(0, anchorX - 3); x <= Math.min(width - 1, anchorX + 3); x += 1) {
      const index = y * width + x;
      if (index !== hazard.cell_index && rewardIndices.length < 16) rewardIndices.push(index);
    }
  }
  const reserved = new Set([hazard.cell_index, ...rewardIndices]);
  const indices = [];
  for (let index = 0; index < width * height; index += 1) {
    if (!reserved.has(index)) indices.push(index);
  }
  let revision = 0;
  for (let offset = 0; offset < indices.length; offset += 64) {
    const saved = await request(`/colorings/${templateId}/progress/actions`, {
      method: 'POST',
      body: {
        revision,
        clientBatchId: `hazard-disarm-completion-prepaint-${offset}`,
        changes: indices.slice(offset, offset + 64).map((index) => ({ index, color: 0 })),
      },
    });
    assert.equal(saved.response.status, 200);
    revision = Number(saved.json.revision);
  }

  const claimed = await request(`/colorings/${templateId}/progress/actions`, {
    method: 'POST',
    body: {
      revision,
      clientBatchId: 'hazard-disarm-completion-claim',
      changes: [{ index: hazard.cell_index, color: 0 }],
      special_action: { type: 'claim_hazard', special_id: hazard.id },
    },
  });
  assert.equal(claimed.response.status, 200);
  assert.equal(claimed.json.special_offer.kind, 'hazard');
  assert.equal(claimed.json.completed_cells, width * height - 16);

  const disarmed = await request(`/colorings/${templateId}/progress/actions`, {
    method: 'POST',
    body: {
      revision: claimed.json.revision,
      clientBatchId: 'hazard-disarm-completion-use',
      changes: [],
      special_action: {
        type: 'disarm_hazard',
        special_id: hazard.id,
        offer_token: claimed.json.special_offer.offer_token,
      },
    },
  });
  assert.equal(disarmed.response.status, 200);
  assert.equal(disarmed.json.special_applied_changes.length, 16);
  assert.equal(disarmed.json.completed_cells, width * height);
  assert.equal(disarmed.json.special_offer, null);
  assert.ok(disarmed.json.completed_at);
});
