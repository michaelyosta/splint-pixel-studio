import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

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
      tiles.push({ tile_x: tileX, tile_y: tileY, width: tileWidth, height: tileHeight, cells: Array(tileWidth * tileHeight).fill(0) });
    }
  }
  return tiles;
}

async function waitForServer(child) {
  await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`server did not start: ${stderr}`)), 60_000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
  });
}

async function startServer(t, userId) {
  const directory = await mkdtemp(join(tmpdir(), 'splint-choice-artifact-'));
  const port = 32300 + (process.pid % 400) + portOffset;
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
      SPECIAL_CELLS_QA_USER_ID: 'choice_artifact_user,choice_reload_user,artifact_reload_user,artifact_small_map_user',
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
  await waitForServer(child);
  return createClient(`http://127.0.0.1:${port}`, userId);
}

async function createTemplate(request, width = 160, height = 160) {
  const response = await request('/colorings/create', {
    method: 'POST',
    body: {
      title: 'Choice artifact integration',
      storageMode: 'tiled',
      width,
      height,
      tileSize: 32,
      palette: ['#101820', '#ffffff'],
      tiles: tiledPayload(width, height),
    },
  });
  assert.equal(response.response.status, 201);
  return response.json.id;
}

async function findKind(request, templateId, kind) {
  for (let tileY = 0; tileY < 5; tileY += 1) {
    for (let tileX = 0; tileX < 5; tileX += 1) {
      const tile = await request(`/colorings/${templateId}/tiles/${tileX}/${tileY}`);
      assert.equal(tile.response.status, 200);
      const found = tile.json.specials?.find((special) => special.kind === kind);
      if (found) return found;
    }
  }
  return null;
}

async function findAllKind(request, templateId, kind, tilesX = 7, tilesY = 7) {
  const result = [];
  for (let tileY = 0; tileY < tilesY; tileY += 1) {
    for (let tileX = 0; tileX < tilesX; tileX += 1) {
      const tile = await request(`/colorings/${templateId}/tiles/${tileX}/${tileY}`);
      assert.equal(tile.response.status, 200);
      for (const special of tile.json.specials || []) {
        if (special.kind === kind && special.state === 'unseen') result.push(special);
      }
    }
  }
  return result;
}

test('Choice uses the existing server-derived target contract and Artifact persists fragments', async (t) => {
  const request = await startServer(t, 'choice_artifact_user');
  const templateId = await createTemplate(request);
  const choice = await findKind(request, templateId, 'choice');
  const artifact = await findKind(request, templateId, 'artifact');
  assert.ok(choice);
  assert.ok(artifact);

  const claimChoiceBody = {
    revision: 0,
    clientBatchId: 'choice-claim-001',
    changes: [{ index: choice.cell_index, color: 0 }],
    special_action: { type: 'claim_choice', special_id: choice.id },
  };
  const claimedChoice = await request(`/colorings/${templateId}/progress/actions`, { method: 'POST', body: claimChoiceBody });
  assert.equal(claimedChoice.response.status, 200);
  assert.equal(claimedChoice.json.special_offer.kind, 'choice');
  assert.deepEqual(claimedChoice.json.special_offer.choice_options.map((option) => option.option_id), ['smart_target', 'local_burst']);

  const choiceUseBody = {
    revision: claimedChoice.json.revision,
    clientBatchId: 'choice-use-001',
    changes: [],
    special_action: {
      type: 'use_choice',
      special_id: choice.id,
      offer_token: claimedChoice.json.special_offer.offer_token,
      option_id: 'local_burst',
    },
  };
  const usedChoice = await request(`/colorings/${templateId}/progress/actions`, { method: 'POST', body: choiceUseBody });
  assert.equal(usedChoice.response.status, 200);
  assert.ok(usedChoice.json.special_applied_changes.length > 0);
  assert.ok(usedChoice.json.special_applied_changes.length <= 32);
  const useReplay = await request(`/colorings/${templateId}/progress/actions`, { method: 'POST', body: choiceUseBody });
  assert.equal(useReplay.response.status, 200);
  assert.equal(useReplay.json.idempotent, true);
  assert.deepEqual(useReplay.json.special_applied_changes, usedChoice.json.special_applied_changes);

  const claimArtifactBody = {
    revision: usedChoice.json.revision,
    clientBatchId: 'artifact-claim-001',
    changes: [{ index: artifact.cell_index, color: 0 }],
    special_action: { type: 'claim_artifact', special_id: artifact.id },
  };
  const claimedArtifact = await request(`/colorings/${templateId}/progress/actions`, { method: 'POST', body: claimArtifactBody });
  assert.equal(claimedArtifact.response.status, 200);
  assert.deepEqual(claimedArtifact.json.special_discovered, {
    special_id: artifact.id,
    kind: 'artifact',
    artifact_fragments: 1,
    artifact_complete: false,
  });
  assert.equal(claimedArtifact.json.special_offer, null);
  const artifactReplay = await request(`/colorings/${templateId}/progress/actions`, { method: 'POST', body: claimArtifactBody });
  assert.equal(artifactReplay.response.status, 200);
  assert.equal(artifactReplay.json.idempotent, true);
  assert.equal(artifactReplay.json.special_discovered, null);
});

test('Choice offer survives progress reload before the explicit decision', async (t) => {
  const request = await startServer(t, 'choice_reload_user');
  const templateId = await createTemplate(request);
  const choice = await findKind(request, templateId, 'choice');
  assert.ok(choice);

  const claimed = await request(`/colorings/${templateId}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'choice-reload-claim',
      changes: [{ index: choice.cell_index, color: 0 }],
      special_action: { type: 'claim_choice', special_id: choice.id },
    },
  });
  assert.equal(claimed.response.status, 200);

  const reloaded = await request(`/colorings/${templateId}/progress`);
  assert.equal(reloaded.response.status, 200);
  assert.equal(reloaded.json.special_offer.kind, 'choice');
  assert.equal(reloaded.json.special_offer.offer_token, claimed.json.special_offer.offer_token);

  const used = await request(`/colorings/${templateId}/progress/actions`, {
    method: 'POST',
    body: {
      revision: reloaded.json.revision,
      clientBatchId: 'choice-reload-use',
      changes: [],
      special_action: {
        type: 'use_choice',
        special_id: choice.id,
        offer_token: reloaded.json.special_offer.offer_token,
        option_id: 'smart_target',
      },
    },
  });
  assert.equal(used.response.status, 200);
  assert.ok(used.json.special_applied_changes.length > 0);
  assert.equal(used.json.special_offer, null);
});

test('Artifact fragment progress survives /progress reload and completes at three fragments', async (t) => {
  const request = await startServer(t, 'artifact_reload_user');
  const templateId = await createTemplate(request, 200, 200);
  const artifacts = await findAllKind(request, templateId, 'artifact');
  assert.ok(artifacts.length >= 3, '200x200 treatment fixture must expose at least three Artifact markers');

  const initial = await request(`/colorings/${templateId}/progress`);
  assert.equal(initial.response.status, 200);
  assert.deepEqual(initial.json.artifact_progress, { fragments: 0, complete: false, total: 3 });

  let revision = Number(initial.json.revision || 0);
  for (let index = 0; index < 3; index += 1) {
    const artifact = artifacts[index];
    const claimed = await request(`/colorings/${templateId}/progress/actions`, {
      method: 'POST',
      body: {
        revision,
        clientBatchId: `artifact-reload-${index}`,
        changes: [{ index: artifact.cell_index, color: 0 }],
        special_action: { type: 'claim_artifact', special_id: artifact.id },
      },
    });
    assert.equal(claimed.response.status, 200);
    assert.deepEqual(claimed.json.artifact_progress, {
      fragments: index + 1,
      complete: index + 1 >= 3,
      total: 3,
    });
    revision = Number(claimed.json.revision);

    const reloaded = await request(`/colorings/${templateId}/progress`);
    assert.equal(reloaded.response.status, 200);
    assert.deepEqual(reloaded.json.artifact_progress, {
      fragments: index + 1,
      complete: index + 1 >= 3,
      total: 3,
    });
  }
});

test('Artifact total is bounded by the deterministic markers on a 160x160 map', async (t) => {
  const request = await startServer(t, 'artifact_small_map_user');
  const templateId = await createTemplate(request, 160, 160);
  const artifacts = await findAllKind(request, templateId, 'artifact', 5, 5);
  const initial = await request(`/colorings/${templateId}/progress`);
  assert.equal(initial.response.status, 200);
  assert.equal(initial.json.artifact_progress.total, Math.min(3, artifacts.length));
  assert.equal(initial.json.artifact_progress.fragments, 0);
});
