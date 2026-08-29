import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { BOMB_RADIUS } from '../services/tiled-specials.js';

const serverCwd = basename(process.cwd()).toLowerCase() === 'server' ? process.cwd() : join(process.cwd(), 'server');
const portBase = 32200 + (process.pid % 500);
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
    const timer = setTimeout(() => reject(new Error(`Bomb integration server did not start${stderr ? `: ${stderr}` : ''}`)), 60_000);
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
      reject(new Error(`Bomb integration server exited before start (code=${code}, signal=${signal})${stderr ? `: ${stderr}` : ''}`));
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
  const directory = await mkdtemp(join(tmpdir(), 'splint-bomb-'));
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
      SPECIAL_CELLS_QA_USER_ID: 'user_bomb_integration,user_bomb_validation,user_bomb_concurrent,user_bomb_control',
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

async function findFirstBomb(request, id) {
  for (let tileY = 0; tileY < 5; tileY += 1) {
    for (let tileX = 0; tileX < 5; tileX += 1) {
      const tile = await request(`/colorings/${id}/tiles/${tileX}/${tileY}`);
      assert.equal(tile.response.status, 200);
      const bomb = tile.json.specials?.find((special) => special.kind === 'bomb');
      if (bomb) return bomb;
    }
  }
  return null;
}

function centerForCell(cellIndex, width) {
  return {
    x: cellIndex % width,
    y: Math.floor(cellIndex / width),
  };
}

test('Bomb claim/use is server-authoritative, bounded, idempotent, and reload-safe', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT');
  const request = createClient(baseUrl, 'user_bomb_integration');
  const id = await createTiledTemplate(request, 'Bomb integration');
  const bomb = await findFirstBomb(request, id);
  assert.ok(bomb, 'created treatment template exposes a Bomb marker');

  const claimBody = {
    revision: 0,
    clientBatchId: 'bomb-claim-001',
    changes: [{ index: bomb.cell_index, color: 0 }],
    special_action: { type: 'claim_bomb', special_id: bomb.id },
  };
  const claimed = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: claimBody });
  assert.equal(claimed.response.status, 200);
  assert.deepEqual(claimed.json.special_discovered, { special_id: bomb.id, kind: 'bomb' });
  assert.equal(claimed.json.special_offer.kind, 'bomb');
  assert.equal(claimed.json.special_offer.radius, BOMB_RADIUS);
  assert.equal(claimed.json.special_offer.target_options, undefined);
  assert.ok(claimed.json.special_offer.offer_token);
  assert.equal(claimed.json.special_applied_changes.length, 0);
  assert.equal(claimed.json.special_offer.center_x, centerForCell(bomb.cell_index, 160).x);
  assert.equal(claimed.json.special_offer.center_y, centerForCell(bomb.cell_index, 160).y);

  const claimReplay = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: claimBody });
  assert.equal(claimReplay.response.status, 200);
  assert.equal(claimReplay.json.idempotent, true);
  assert.equal(claimReplay.json.special_offer.offer_token, claimed.json.special_offer.offer_token);

  const reloaded = await request(`/colorings/${id}/progress`);
  assert.equal(reloaded.response.status, 200);
  assert.equal(reloaded.json.special_offer.kind, 'bomb');
  assert.equal(reloaded.json.special_offer.radius, BOMB_RADIUS);
  assert.equal(reloaded.json.special_offer.offer_token, claimed.json.special_offer.offer_token);
  assert.equal(reloaded.json.special_offer.center_x, centerForCell(bomb.cell_index, 160).x);
  assert.equal(reloaded.json.special_offer.center_y, centerForCell(bomb.cell_index, 160).y);

  const center = {
    x: reloaded.json.special_offer.center_x,
    y: reloaded.json.special_offer.center_y,
  };
  const useBody = {
    revision: reloaded.json.revision,
    clientBatchId: 'bomb-use-001',
    changes: [],
    special_action: {
      type: 'use_bomb',
      special_id: bomb.id,
      offer_token: reloaded.json.special_offer.offer_token,
      center_x: center.x,
      center_y: center.y,
    },
  };
  const used = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: useBody });
  assert.equal(used.response.status, 200);
  assert.ok(used.json.special_applied_changes.length > 0);
  assert.ok(used.json.special_applied_changes.length <= 32);
  for (const change of used.json.special_applied_changes) {
    assert.equal(change.color, 0);
  }
  assert.equal(used.json.special_diagnostics.counts_by_status.consumed, 1);

  const useReplay = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: useBody });
  assert.equal(useReplay.response.status, 200);
  assert.equal(useReplay.json.idempotent, true);
  assert.deepEqual(useReplay.json.special_applied_changes, used.json.special_applied_changes);

  const duplicateUse = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: { ...useBody, clientBatchId: 'bomb-use-002', revision: used.json.revision },
  });
  assert.equal(duplicateUse.response.status, 409);
  assert.equal(duplicateUse.json.code, 'SPECIAL_OFFER_STALE');
});

test('Bomb use requires center intent and rejects forged or invalid actions', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT');
  const request = createClient(baseUrl, 'user_bomb_validation');
  const id = await createTiledTemplate(request, 'Bomb validation');
  const bomb = await findFirstBomb(request, id);
  assert.ok(bomb);

  const claimed = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'bomb-claim-validation-001',
      changes: [{ index: bomb.cell_index, color: 0 }],
      special_action: { type: 'claim_bomb', special_id: bomb.id },
    },
  });
  assert.equal(claimed.response.status, 200);

  const missingCenter = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: claimed.json.revision,
      clientBatchId: 'bomb-use-missing-center',
      changes: [],
      special_action: {
        type: 'use_bomb',
        special_id: bomb.id,
        offer_token: claimed.json.special_offer.offer_token,
      },
    },
  });
  assert.equal(missingCenter.response.status, 400);
  assert.equal(missingCenter.json.code, 'INVALID_SPECIAL_ACTION');

  const unknownAction = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: claimed.json.revision,
      clientBatchId: 'bomb-unknown-action',
      changes: [],
      special_action: { type: 'use_fuse', special_id: bomb.id },
    },
  });
  assert.equal(unknownAction.response.status, 400);
  assert.equal(unknownAction.json.code, 'INVALID_SPECIAL_ACTION');
});

test('concurrent Bomb use spends one offer and applies one bounded effect', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT');
  const request = createClient(baseUrl, 'user_bomb_concurrent');
  const id = await createTiledTemplate(request, 'Bomb concurrent');
  const bomb = await findFirstBomb(request, id);
  assert.ok(bomb);
  const claimed = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'bomb-concurrent-claim',
      changes: [{ index: bomb.cell_index, color: 0 }],
      special_action: { type: 'claim_bomb', special_id: bomb.id },
    },
  });
  assert.equal(claimed.response.status, 200);
  const center = {
    x: claimed.json.special_offer.center_x,
    y: claimed.json.special_offer.center_y,
  };
  const body = (clientBatchId) => ({
    revision: claimed.json.revision,
    clientBatchId,
    changes: [],
    special_action: {
      type: 'use_bomb',
      special_id: bomb.id,
      offer_token: claimed.json.special_offer.offer_token,
      center_x: center.x,
      center_y: center.y,
    },
  });
  const [left, right] = await Promise.all([
    request(`/colorings/${id}/progress/actions`, { method: 'POST', body: body('bomb-concurrent-a') }),
    request(`/colorings/${id}/progress/actions`, { method: 'POST', body: body('bomb-concurrent-b') }),
  ]);
  const statuses = [left.response.status, right.response.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 409]);
  const winner = left.response.status === 200 ? left : right;
  assert.ok(winner.json.special_applied_changes.length > 0);
  assert.ok(winner.json.special_applied_changes.length <= 32);
});

test('Bomb control cohort stays at zero metadata and rejects forged claims', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_CONTROL');
  const request = createClient(baseUrl, 'user_bomb_control');
  const id = await createTiledTemplate(request, 'Bomb control');

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
      clientBatchId: 'bomb-forged-claim',
      changes: [{ index: 0, color: 0 }],
      special_action: { type: 'claim_bomb', special_id: 'sc_forged_bomb' },
    },
  });
  assert.equal(forged.response.status, 404);
  assert.equal(forged.json.code, 'SPECIAL_COHORT_CONTROL');
});
