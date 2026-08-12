import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  FUSE_CHAIN_MAX_STEPS,
  SPECIAL_MAX_DERIVED_CHANGES,
  deriveFuseChanges,
} from '../services/tiled-specials.js';

const serverCwd = basename(process.cwd()).toLowerCase() === 'server' ? process.cwd() : join(process.cwd(), 'server');
const portBase = 32300 + (process.pid % 500);
let portOffset = 0;

function nextPort() {
  const port = portBase + portOffset;
  portOffset += 1;
  return port;
}

function createClient(baseUrl, clientUserId) {
  return async function request(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-User-Id': clientUserId },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    return { response, json };
  };
}

async function waitForServer(child) {
  await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Fuse integration server did not start${stderr ? `: ${stderr}` : ''}`)), 60_000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString().trim();
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Fuse integration server exited before start (code=${code}, signal=${signal})${stderr ? `: ${stderr}` : ''}`));
    });
  });
}

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

function stopChild(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const onExit = () => resolve();
    child.once('exit', onExit);
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }, 3_000).unref?.();
  });
}

async function startServer(t, cohort) {
  const directory = await mkdtemp(join(tmpdir(), 'splint-fuse-'));
  const port = nextPort();
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
      SPECIAL_CELLS_COHORT: cohort,
      SPECIAL_CELLS_QA_OVERRIDE: 'true',
      SPECIAL_CELLS_QA_USER_ID: 'user_fuse_integration,user_fuse_completion,user_fuse_skip,user_fuse_control',
      SPECIAL_CELLS_DIAGNOSTICS: 'true',
      RATE_LIMIT_MAX: '10000',
      RENDER_OUTBOX_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    await stopChild(child);
    await rm(directory, { recursive: true, force: true });
  });
  await waitForServer(child);
  return `http://127.0.0.1:${port}`;
}

async function createTiledTemplate(request, title) {
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

async function findFirstFuse(request, id) {
  for (let tileY = 0; tileY < 5; tileY += 1) {
    for (let tileX = 0; tileX < 5; tileX += 1) {
      const tile = await request(`/colorings/${id}/tiles/${tileX}/${tileY}`);
      assert.equal(tile.response.status, 200);
      const fuse = tile.json.specials?.find((special) => special.kind === 'fuse');
      if (fuse) return fuse;
    }
  }
  return null;
}

async function paintAllExcept(request, id, exclude, width, height) {
  const indices = [];
  for (let index = 0; index < width * height; index += 1) {
    if (!exclude.has(index)) indices.push(index);
  }
  let revision = 0;
  for (let offset = 0; offset < indices.length; offset += 64) {
    const batch = indices.slice(offset, offset + 64).map((index) => ({ index, color: 0 }));
    const saved = await request(`/colorings/${id}/progress/actions`, {
      method: 'POST',
      body: {
        revision,
        clientBatchId: `fuse-prepaint-${offset}`,
        changes: batch,
      },
    });
    assert.equal(saved.response.status, 200);
    revision = Number(saved.json.revision);
  }
  return revision;
}

test('Fuse claim returns a bounded disarm offer, resolves once, and replays idempotently', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT');
  const request = createClient(baseUrl, 'user_fuse_integration');
  const id = await createTiledTemplate(request, 'Fuse integration');
  const fuse = await findFirstFuse(request, id);
  assert.ok(fuse, 'created treatment template exposes a Fuse marker');
  const expected = deriveFuseChanges({
    cells: Array(160 * 160).fill(0),
    filled: Array(160 * 160).fill(-1),
    width: 160,
    height: 160,
    specialIndex: fuse.cell_index,
  });
  assert.ok(expected.length > 0);

  const claimBody = {
    revision: 0,
    clientBatchId: 'fuse-claim-001',
    changes: [{ index: fuse.cell_index, color: 0 }],
    special_action: { type: 'claim_fuse', special_id: fuse.id },
  };
  const claimed = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: claimBody });
  assert.equal(claimed.response.status, 200);
  assert.deepEqual(claimed.json.special_discovered, { special_id: fuse.id, kind: 'fuse' });
  assert.equal(claimed.json.special_offer.kind, 'fuse');
  assert.equal(claimed.json.special_offer.disarm, true);
  assert.ok(claimed.json.special_offer.steps.length >= 1);
  assert.ok(claimed.json.special_offer.steps.length <= FUSE_CHAIN_MAX_STEPS);
  assert.ok(claimed.json.special_offer.steps[0].cells > 0);
  assert.equal(claimed.json.special_offer.target_options, undefined);
  assert.ok(claimed.json.special_offer.offer_token);
  assert.equal(claimed.json.special_applied_changes.length, 0);

  const claimReplay = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: claimBody });
  assert.equal(claimReplay.response.status, 200);
  assert.equal(claimReplay.json.idempotent, true);
  assert.equal(claimReplay.json.special_offer.offer_token, claimed.json.special_offer.offer_token);

  const reloaded = await request(`/colorings/${id}/progress`);
  assert.equal(reloaded.response.status, 200);
  assert.equal(reloaded.json.special_offer.kind, 'fuse');
  assert.equal(reloaded.json.special_offer.offer_token, claimed.json.special_offer.offer_token);

  let revision = reloaded.json.revision;
  const staleRevision = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: reloaded.json.revision - 1,
      clientBatchId: 'fuse-stale-revision',
      changes: [],
      special_action: {
        type: 'disarm_fuse',
        special_id: fuse.id,
        offer_token: reloaded.json.special_offer.offer_token,
      },
    },
  });
  assert.equal(staleRevision.response.status, 409);
  assert.ok(staleRevision.json.progress);
  assert.equal(staleRevision.json.progress.revision, reloaded.json.revision);

  const applied = [];
  let current = reloaded.json;
  let firstDisarmReplay = null;
  let stepIndex = 0;
  while (current.special_offer) {
    stepIndex += 1;
    const disarmBody = {
      revision,
      clientBatchId: `fuse-disarm-${String(stepIndex).padStart(3, '0')}`,
      changes: [],
      special_action: {
        type: 'disarm_fuse',
        special_id: fuse.id,
        offer_token: current.special_offer.offer_token,
      },
    };
    const disarmed = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: disarmBody });
    assert.equal(disarmed.response.status, 200);
    assert.ok(disarmed.json.special_applied_changes.length > 0);
    assert.ok(disarmed.json.special_applied_changes.length <= SPECIAL_MAX_DERIVED_CHANGES);
    assert.ok(disarmed.json.special_applied_changes.every((change) => !applied.some((previous) => previous.index === change.index)));
    applied.push(...disarmed.json.special_applied_changes);
    if (stepIndex === 1) {
      const replay = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: disarmBody });
      assert.equal(replay.response.status, 200);
      assert.equal(replay.json.idempotent, true);
      assert.deepEqual(replay.json.special_applied_changes, disarmed.json.special_applied_changes);
      assert.equal(replay.json.special_offer?.offer_token, disarmed.json.special_offer?.offer_token);
      firstDisarmReplay = replay;
    }
    revision = disarmed.json.revision;
    current = disarmed.json;
  }
  assert.ok(stepIndex >= 1);
  assert.equal(applied.length, expected.length);
  assert.deepEqual(applied.map((change) => change.index).sort((a, b) => a - b), expected.map((change) => change.index).sort((a, b) => a - b));
  assert.equal(current.special_diagnostics.counts_by_status.consumed, 1);
  assert.equal(firstDisarmReplay.json.special_diagnostics.counts_by_status.offered, 1);

  const duplicate = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision,
      clientBatchId: 'fuse-duplicate-after-consumed',
      changes: [],
      special_action: {
        type: 'disarm_fuse',
        special_id: fuse.id,
        offer_token: reloaded.json.special_offer.offer_token,
      },
    },
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.json.code, 'SPECIAL_OFFER_STALE');
});

test('Fuse disarm can be the completing action without losing progress', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT');
  const request = createClient(baseUrl, 'user_fuse_completion');
  const id = await createTiledTemplate(request, 'Fuse completion race');
  const fuse = await findFirstFuse(request, id);
  assert.ok(fuse);

  const expected = deriveFuseChanges({
    cells: Array(160 * 160).fill(0),
    filled: Array(160 * 160).fill(-1),
    width: 160,
    height: 160,
    specialIndex: fuse.cell_index,
  });
  assert.ok(expected.length > 0);
  const claimedFuseCell = fuse.cell_index;
  const exclude = new Set(expected.map((change) => change.index));
  exclude.add(claimedFuseCell);
  const revision = await paintAllExcept(request, id, exclude, 160, 160);

  const claimed = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision,
      clientBatchId: 'fuse-completion-claim',
      changes: [{ index: fuse.cell_index, color: 0 }],
      special_action: { type: 'claim_fuse', special_id: fuse.id },
    },
  });
  assert.equal(claimed.response.status, 200);
  assert.ok(claimed.json.special_offer);

  const applied = [];
  let nextRevision = claimed.json.revision;
  let current = claimed.json;
  let stepIndex = 0;
  while (current.special_offer) {
    stepIndex += 1;
    const disarmed = await request(`/colorings/${id}/progress/actions`, {
      method: 'POST',
      body: {
        revision: nextRevision,
        clientBatchId: `fuse-completion-disarm-${stepIndex}`,
        changes: [],
        special_action: {
          type: 'disarm_fuse',
          special_id: fuse.id,
          offer_token: current.special_offer.offer_token,
        },
      },
    });
    assert.equal(disarmed.response.status, 200);
    assert.ok(disarmed.json.special_applied_changes.length > 0);
    applied.push(...disarmed.json.special_applied_changes);
    nextRevision = disarmed.json.revision;
    current = disarmed.json;
  }
  assert.ok(stepIndex >= 1);
  assert.deepEqual(
    applied.map((change) => change.index).sort((a, b) => a - b),
    expected.map((change) => change.index).sort((a, b) => a - b),
  );
  assert.equal(current.completed_cells, 160 * 160);
  assert.ok(current.completed_at);
  assert.equal(current.percent, 100);
  assert.equal(current.special_offer, null);
  assert.equal(current.special_diagnostics.counts_by_status.consumed, 1);
  assert.equal(current.special_diagnostics.active_special_id, null);
  assert.equal(
    current.special_diagnostics.counts_by_status.offered,
    0,
    'a completing disarm must not leave the offer open',
  );
});

test('Fuse can be skipped deliberately without removing painting progress', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT');
  const request = createClient(baseUrl, 'user_fuse_skip');
  const id = await createTiledTemplate(request, 'Fuse skip');
  const fuse = await findFirstFuse(request, id);
  assert.ok(fuse);

  const claimed = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'fuse-skip-claim',
      changes: [{ index: fuse.cell_index, color: 0 }],
      special_action: { type: 'claim_fuse', special_id: fuse.id },
    },
  });
  assert.equal(claimed.response.status, 200);
  assert.ok(claimed.json.special_offer?.offer_token);

  const skipped = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: claimed.json.revision,
      clientBatchId: 'fuse-skip-use',
      changes: [],
      special_action: {
        type: 'skip_fuse',
        special_id: fuse.id,
        offer_token: claimed.json.special_offer.offer_token,
      },
    },
  });
  assert.equal(skipped.response.status, 200);
  assert.equal(skipped.json.special_offer, null);
  assert.equal(skipped.json.special_diagnostics.counts_by_status.skipped, 1);
  assert.equal(skipped.json.completed_cells, 1);
});

test('Fuse control cohort stays at zero metadata and rejects forged claims', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_CONTROL');
  const request = createClient(baseUrl, 'user_fuse_control');
  const id = await createTiledTemplate(request, 'Fuse control');

  const progress = await request(`/colorings/${id}/progress`);
  assert.equal(progress.response.status, 200);
  assert.equal(progress.json.specials_experiment_group, 'control');

  for (let tileY = 0; tileY < 5; tileY += 1) {
    for (let tileX = 0; tileX < 5; tileX += 1) {
      const tile = await request(`/colorings/${id}/tiles/${tileX}/${tileY}`);
      assert.equal(tile.response.status, 200);
      assert.deepEqual(tile.json.specials, []);
    }
  }

  const forged = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'fuse-forged-claim',
      changes: [{ index: 0, color: 0 }],
      special_action: { type: 'claim_fuse', special_id: 'sc_forged_fuse' },
    },
  });
  assert.equal(forged.response.status, 404);
  assert.equal(forged.json.code, 'SPECIAL_COHORT_CONTROL');
});
