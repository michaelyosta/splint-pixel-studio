import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const serverCwd = basename(process.cwd()).toLowerCase() === 'server' ? process.cwd() : join(process.cwd(), 'server');
const portBase = 32400 + (process.pid % 400);
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
    const timer = setTimeout(() => reject(new Error(`concurrency integration server did not start${stderr ? `: ${stderr}` : ''}`)), 60_000);
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
      reject(new Error(`concurrency integration server exited before start (code=${code}, signal=${signal})${stderr ? `: ${stderr}` : ''}`));
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
  const directory = await mkdtemp(join(tmpdir(), 'splint-concurrency-'));
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
      SPECIAL_CELLS_QA_USER_ID: 'user_choice_concurrent_offer,user_choice_concurrent_replay,user_special_offer_barrier,user_choice_stale_revision,user_artifact_idempotency,user_artifact_completion,user_choice_completion,user_control_choice_artifact',
      SPECIAL_CELLS_DIAGNOSTICS: 'true',
      SPECIAL_CELLS_LEGACY_CHOICE_FIXTURE: 'true',
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

async function createTiledTemplate(request, title, width = 120, height = 120) {
  const created = await request('/colorings/create', {
    method: 'POST',
    body: {
      title,
      storageMode: 'tiled',
      width,
      height,
      tileSize: 32,
      palette: ['#101820', '#ffffff'],
      tiles: tiledPayload(width, height),
    },
  });
  assert.equal(created.response.status, 201);
  return created.json.id;
}

async function findKind(request, id, kind, width, height) {
  const tilesX = Math.ceil(width / 32);
  const tilesY = Math.ceil(height / 32);
  for (let tileY = 0; tileY < tilesY; tileY += 1) {
    for (let tileX = 0; tileX < tilesX; tileX += 1) {
      const tile = await request(`/colorings/${id}/tiles/${tileX}/${tileY}`);
      assert.equal(tile.response.status, 200);
      const found = tile.json.specials?.find((special) => special.kind === kind);
      if (found) return found;
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
        clientBatchId: `concurrency-prepaint-${offset}`,
        changes: batch,
      },
    });
    assert.equal(saved.response.status, 200);
    revision = Number(saved.json.revision);
  }
  return revision;
}

function choiceUseBody(claim, id, clientBatchId, revision, optionId = 'local_burst') {
  return {
    revision,
    clientBatchId,
    changes: [],
    special_action: {
      type: 'use_choice',
      special_id: id,
      offer_token: claim.json.special_offer.offer_token,
      option_id: optionId,
    },
  };
}

test('concurrent same Choice offer applies exactly one server effect', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT');
  const request = createClient(baseUrl, 'user_choice_concurrent_offer');
  const id = await createTiledTemplate(request, 'Choice concurrent offer');
  const choice = await findKind(request, id, 'choice', 120, 120);
  assert.ok(choice);

  const claimed = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'concurrent-choice-claim-001',
      changes: [{ index: choice.cell_index, color: 0 }],
      special_action: { type: 'claim_choice', special_id: choice.id },
    },
  });
  assert.equal(claimed.response.status, 200);

  const first = request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: choiceUseBody(claimed, choice.id, 'concurrent-choice-use-a', claimed.json.revision),
  });
  const second = request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: choiceUseBody(claimed, choice.id, 'concurrent-choice-use-b', claimed.json.revision),
  });
  const [resultA, resultB] = await Promise.all([first, second]);
  const statuses = [resultA.response.status, resultB.response.status].sort((x, y) => x - y);
  assert.deepEqual(statuses, [200, 409]);

  const winner = resultA.response.status === 200 ? resultA : resultB;
  const loser = resultA.response.status === 200 ? resultB : resultA;
  assert.ok(winner.json.special_applied_changes.length > 0);
  assert.ok(winner.json.special_applied_changes.length <= 32);
  assert.equal(winner.json.special_diagnostics.counts_by_status.consumed, 1);
  assert.ok(loser.response.status === 409);

  const after = await request(`/colorings/${id}/progress`);
  assert.equal(after.response.status, 200);
  assert.equal(after.json.special_offer, null);
  assert.equal(after.json.special_diagnostics.counts_by_status.consumed, 1);
});

test('concurrent replay with the same Choice client batch is idempotent', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT');
  const request = createClient(baseUrl, 'user_choice_concurrent_replay');
  const id = await createTiledTemplate(request, 'Choice concurrent replay');
  const choice = await findKind(request, id, 'choice', 120, 120);
  assert.ok(choice);

  const claimed = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'concurrent-replay-claim',
      changes: [{ index: choice.cell_index, color: 0 }],
      special_action: { type: 'claim_choice', special_id: choice.id },
    },
  });
  assert.equal(claimed.response.status, 200);

  const body = choiceUseBody(claimed, choice.id, 'concurrent-replay-use', claimed.json.revision);
  const [resultA, resultB] = await Promise.all([
    request(`/colorings/${id}/progress/actions`, { method: 'POST', body }),
    request(`/colorings/${id}/progress/actions`, { method: 'POST', body }),
  ]);
  assert.equal(resultA.response.status, 200);
  assert.equal(resultB.response.status, 200);
  assert.ok(resultA.json.idempotent === true || resultB.json.idempotent === true);
  assert.deepEqual(resultA.json.special_applied_changes, resultB.json.special_applied_changes);
  assert.equal(resultA.json.special_diagnostics.counts_by_status.consumed, 1);
  assert.equal(resultB.json.special_diagnostics.counts_by_status.consumed, 1);
});

test('active special offer blocks ordinary batches so reload recovery stays bounded', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT');
  const request = createClient(baseUrl, 'user_special_offer_barrier');
  const id = await createTiledTemplate(request, 'Special offer barrier');
  const choice = await findKind(request, id, 'choice', 120, 120);
  assert.ok(choice);

  const claimed = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'barrier-choice-claim',
      changes: [{ index: choice.cell_index, color: 0 }],
      special_action: { type: 'claim_choice', special_id: choice.id },
    },
  });
  assert.equal(claimed.response.status, 200);

  const ordinaryIndex = choice.cell_index === 0 ? 1 : 0;
  const blocked = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: claimed.json.revision,
      clientBatchId: 'barrier-ordinary-attempt',
      changes: [{ index: ordinaryIndex, color: 0 }],
    },
  });
  assert.equal(blocked.response.status, 409);
  assert.equal(blocked.json.code, 'SPECIAL_ACTIVE_OFFER');

  const recovered = await request(`/colorings/${id}/progress`);
  assert.equal(recovered.response.status, 200);
  assert.equal(recovered.json.special_offer.special_id, choice.id);
  assert.equal(recovered.json.special_offer.offer_token, claimed.json.special_offer.offer_token);

  const used = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: choiceUseBody(
      claimed,
      choice.id,
      'barrier-choice-use',
      recovered.json.revision,
    ),
  });
  assert.equal(used.response.status, 200);
  assert.equal(used.json.special_offer, null);
});

test('stale revision does not spend the Choice offer; replay and duplicate are bounded', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT');
  const request = createClient(baseUrl, 'user_choice_stale_revision');
  const id = await createTiledTemplate(request, 'Choice stale revision');
  const choice = await findKind(request, id, 'choice', 120, 120);
  assert.ok(choice);

  const claimed = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'stale-choice-claim',
      changes: [{ index: choice.cell_index, color: 0 }],
      special_action: { type: 'claim_choice', special_id: choice.id },
    },
  });
  assert.equal(claimed.response.status, 200);

  const stale = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: choiceUseBody(claimed, choice.id, 'stale-choice-use', 0),
  });
  assert.equal(stale.response.status, 409);
  assert.ok(stale.json.progress, 'CAS conflict returns server progress');

  const before = await request(`/colorings/${id}/progress`);
  assert.ok(before.json.special_offer);
  assert.equal(before.json.special_diagnostics.counts_by_status.consumed, 0);

  const body = choiceUseBody(claimed, choice.id, 'stale-choice-valid-use', claimed.json.revision);
  const used = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body });
  assert.equal(used.response.status, 200);
  assert.ok(used.json.special_applied_changes.length > 0);
  assert.equal(used.json.special_diagnostics.counts_by_status.consumed, 1);

  const replay = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.json.idempotent, true);
  assert.deepEqual(replay.json.special_applied_changes, used.json.special_applied_changes);

  const duplicate = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: choiceUseBody(claimed, choice.id, 'stale-choice-duplicate-use', used.json.revision),
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.json.code, 'SPECIAL_OFFER_STALE');
});

test('Artifact claim is idempotent and cannot create a second fragment', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT');
  const request = createClient(baseUrl, 'user_artifact_idempotency');
  const id = await createTiledTemplate(request, 'Artifact idempotency');
  const artifact = await findKind(request, id, 'artifact', 120, 120);
  assert.ok(artifact);

  const claimBody = {
    revision: 0,
    clientBatchId: 'artifact-idem-claim',
    changes: [{ index: artifact.cell_index, color: 0 }],
    special_action: { type: 'claim_artifact', special_id: artifact.id },
  };
  const claimed = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: claimBody });
  assert.equal(claimed.response.status, 200);
  assert.deepEqual(claimed.json.special_discovered, {
    special_id: artifact.id,
    kind: 'artifact',
    artifact_fragments: 1,
    artifact_complete: false,
  });
  assert.equal(claimed.json.special_offer, null);

  const replay = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: claimBody });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.json.idempotent, true);
  assert.equal(replay.json.special_discovered, null);

  const duplicate = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      ...claimBody,
      clientBatchId: 'artifact-idem-claim-duplicate',
      revision: claimed.json.revision,
    },
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.json.code, 'SPECIAL_CLAIM_INVALID');
});

test('Artifact claim as the last cell completes exactly once under replay', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT');
  const request = createClient(baseUrl, 'user_artifact_completion');
  const id = await createTiledTemplate(request, 'Artifact completion race');
  const artifact = await findKind(request, id, 'artifact', 120, 120);
  assert.ok(artifact);

  const revision = await paintAllExcept(request, id, new Set([artifact.cell_index]), 120, 120);
  const claimBody = {
    revision,
    clientBatchId: 'artifact-completion-claim',
    changes: [{ index: artifact.cell_index, color: 0 }],
    special_action: { type: 'claim_artifact', special_id: artifact.id },
  };
  const claimed = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: claimBody });
  assert.equal(claimed.response.status, 200);
  assert.equal(claimed.json.completed_cells, 120 * 120);
  assert.equal(claimed.json.percent, 100);
  assert.ok(claimed.json.completed_at);
  assert.equal(claimed.json.special_offer, null);
  assert.equal(claimed.json.special_discovered.artifact_fragments, 1);

  const replay = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: claimBody });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.json.idempotent, true);
  assert.equal(replay.json.completed_at, claimed.json.completed_at);
  assert.equal(replay.json.special_discovered, null);

  const duplicate = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      ...claimBody,
      clientBatchId: 'artifact-completion-claim-duplicate',
      revision: claimed.json.revision,
    },
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.json.code, 'SPECIAL_CLAIM_INVALID');
});

test('Choice claim as the last cell must not leave an uncloseable offer', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT');
  const request = createClient(baseUrl, 'user_choice_completion');
  const id = await createTiledTemplate(request, 'Choice completion race');
  const choice = await findKind(request, id, 'choice', 120, 120);
  assert.ok(choice);

  const revision = await paintAllExcept(request, id, new Set([choice.cell_index]), 120, 120);
  const claimed = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision,
      clientBatchId: 'choice-completion-claim',
      changes: [{ index: choice.cell_index, color: 0 }],
      special_action: { type: 'claim_choice', special_id: choice.id },
    },
  });
  assert.equal(claimed.response.status, 200);
  assert.equal(claimed.json.completed_cells, 120 * 120);
  assert.equal(claimed.json.percent, 100);
  assert.ok(claimed.json.completed_at);
  assert.equal(claimed.json.special_offer, null, 'completing claim must not leave a dead offer');
});

test('control cohort rejects forged Choice and Artifact actions and exposes no specials', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_CONTROL');
  const request = createClient(baseUrl, 'user_control_choice_artifact');
  const id = await createTiledTemplate(request, 'Control Choice Artifact');

  const progress = await request(`/colorings/${id}/progress`);
  assert.equal(progress.response.status, 200);
  assert.equal(progress.json.specials_experiment_group, 'control');

  for (let tileY = 0; tileY < 4; tileY += 1) {
    for (let tileX = 0; tileX < 4; tileX += 1) {
      const tile = await request(`/colorings/${id}/tiles/${tileX}/${tileY}`);
      assert.equal(tile.response.status, 200);
      assert.deepEqual(tile.json.specials, []);
    }
  }

  const forgedChoice = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'control-choice-claim',
      changes: [{ index: 0, color: 0 }],
      special_action: { type: 'claim_choice', special_id: 'sc_forged_choice' },
    },
  });
  assert.equal(forgedChoice.response.status, 404);
  assert.equal(forgedChoice.json.code, 'SPECIAL_COHORT_CONTROL');

  const forgedUse = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'control-choice-use',
      changes: [],
      special_action: {
        type: 'use_choice',
        special_id: 'sc_forged_choice',
        offer_token: 'a'.repeat(32),
        option_id: 'local_burst',
      },
    },
  });
  assert.equal(forgedUse.response.status, 404);
  assert.equal(forgedUse.json.code, 'SPECIAL_COHORT_CONTROL');

  const forgedArtifact = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'control-artifact-claim',
      changes: [{ index: 0, color: 0 }],
      special_action: { type: 'claim_artifact', special_id: 'sc_forged_artifact' },
    },
  });
  assert.equal(forgedArtifact.response.status, 404);
  assert.equal(forgedArtifact.json.code, 'SPECIAL_COHORT_CONTROL');
});
