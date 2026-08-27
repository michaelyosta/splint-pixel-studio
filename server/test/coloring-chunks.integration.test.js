import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..');
const port = 31919;
const baseUrl = `http://127.0.0.1:${port}`;

async function request(path, { userId = 'user_pixelhunter', method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['X-User-Id'] = userId;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = response.headers.get('content-type')?.includes('application/json')
    ? await response.json().catch(() => ({}))
    : {};
  return { response, json };
}

async function waitForServer(server) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chunk API server did not start')), 10_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once('error', reject);
  });
}

async function waitFor(predicate, { timeout = 15_000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`Timed out waiting for condition (last=${JSON.stringify(last)})`);
}

function tiledPayload(width, height, tileSize = 32) {
  const tiles = [];
  const tilesX = Math.ceil(width / tileSize);
  const tilesY = Math.ceil(height / tileSize);
  for (let tileY = 0; tileY < tilesY; tileY += 1) {
    for (let tileX = 0; tileX < tilesX; tileX += 1) {
      const tileWidth = Math.min(tileSize, width - tileX * tileSize);
      const tileHeight = Math.min(tileSize, height - tileY * tileSize);
      tiles.push({ tile_x: tileX, tile_y: tileY, width: tileWidth, height: tileHeight, cells: Array(tileWidth * tileHeight).fill(0) });
    }
  }
  return tiles;
}

test('manifest and tile API projects legacy arrays without exposing an unsafe public limit', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-chunks-'));
  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL: '',
      PORT: String(port),
      SQLITE_DB_PATH: join(directory, 'test.db.bin'),
      MEDIA_STORAGE_ROOT: join(directory, 'uploads'),
      ALLOW_DEV_AUTH: 'true',
      SEED_DEMO_DATA: 'true',
      RATE_LIMIT_MAX: '10000',
      RENDER_OUTBOX_ENABLED: 'true',
      RENDER_OUTBOX_POLL_MS: '25',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    server.kill();
    await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  });
  await waitForServer(server);

  const unauthorized = await request('/colorings/color_neon-cat/manifest', { auth: false });
  assert.equal(unauthorized.response.status, 401);

  const manifest = await request('/colorings/color_neon-cat/manifest');
  assert.equal(manifest.response.status, 200);
  assert.equal(manifest.json.schema_version, 1);
  assert.deepEqual(manifest.json.grid, {
    width: 32,
    height: 32,
    tile_size: 32,
    tiles_x: 1,
    tiles_y: 1,
    encoding: 'row-major-palette-index',
  });
  assert.equal(manifest.json.progress.revision, 0);
  assert.equal(manifest.json.write_contract.max_changes, 64);
  assert.equal(manifest.json.write_contract.revision_field, 'revision');
  assert.equal(manifest.json.write_contract.idempotency.header, 'Idempotency-Key');
  assert.equal(Object.hasOwn(manifest.json, 'cells'), false);
  assert.equal(Object.hasOwn(manifest.json, 'filled'), false);
  assert.doesNotMatch(JSON.stringify(manifest.json), /cells_json|filled_json/);

  const beforeTemplate = await request('/colorings/color_neon-cat');
  const firstTile = await request('/colorings/color_neon-cat/tiles/0/0');
  assert.equal(firstTile.response.status, 200);
  assert.equal(firstTile.json.tile.cell_count, 32 * 32);
  assert.equal(firstTile.json.cells.length, 32 * 32);
  assert.equal(firstTile.json.filled.length, 32 * 32);
  assert.ok(firstTile.json.filled.every((value) => value === -1));
  assert.equal(firstTile.json.progress.revision, 0);
  assert.deepEqual(firstTile.json, (await request('/colorings/color_neon-cat/chunks/0/0')).json);
  const afterTemplate = await request('/colorings/color_neon-cat');
  assert.deepEqual(afterTemplate.json.cells, beforeTemplate.json.cells, 'tile reads preserve legacy cells');

  const maxGrid = await request('/colorings/create', {
    method: 'POST',
    body: {
      title: 'Tile contract 160',
      width: 160,
      height: 160,
      palette: ['#000000', '#ffffff'],
      cells: Array(160 * 160).fill(0),
    },
  });
  assert.equal(maxGrid.response.status, 201);
  const maxId = maxGrid.json.id;
  const maxManifest = await request(`/colorings/${maxId}/manifest`);
  assert.equal(maxManifest.response.status, 200);
  assert.equal(maxManifest.json.grid.tiles_x, 5);
  assert.equal(maxManifest.json.grid.tiles_y, 5);
  const maxTile = await request(`/colorings/${maxId}/tiles/4/4`);
  assert.equal(maxTile.response.status, 200);
  assert.equal(maxTile.json.tile.width, 32);
  assert.equal(maxTile.json.tile.height, 32);
  assert.equal(maxTile.json.cells.length, 1024);

  const progressBefore = await request(`/colorings/${maxId}/progress`);
  const actionBody = {
    revision: progressBefore.json.revision,
    clientBatchId: 'chunk-contract-batch-001',
    changes: [{ index: 0, color: 0 }],
  };
  const action = await request(`/colorings/${maxId}/progress/actions`, { method: 'POST', body: actionBody });
  assert.equal(action.response.status, 200);
  assert.equal(action.json.revision, 1);
  const replay = await request(`/colorings/${maxId}/progress/actions`, { method: 'POST', body: actionBody });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.json.idempotent, true);
  const tileAfterAction = await request(`/colorings/${maxId}/tiles/0/0`);
  assert.equal(tileAfterAction.json.progress.revision, 1);
  assert.equal(tileAfterAction.json.filled[0], 0);
  assert.deepEqual(maxGrid.json.cells, (await request(`/colorings/${maxId}`)).json.cells, 'progress writes preserve legacy template cells');

  for (const path of [`/colorings/${maxId}/tiles/5/0`, `/colorings/${maxId}/chunks/0/5`, `/colorings/${maxId}/tiles/-1/0`, `/colorings/${maxId}/tiles/1.5/0`]) {
    const invalid = await request(path);
    assert.equal(invalid.response.status, 400, path);
    assert.equal(invalid.json.code, 'INVALID_TILE_COORDINATES', path);
  }

  const tooLarge = await request('/colorings/create', {
    method: 'POST',
    body: {
      title: 'Still rejected over public limit',
      width: 161,
      height: 161,
      palette: ['#000000', '#ffffff'],
      cells: Array(161 * 161).fill(0),
    },
  });
  assert.equal(tooLarge.response.status, 422);
  assert.equal(tooLarge.json.code, 'INCOMPLETE_TILED_TEMPLATE');

  const tiled = await request('/colorings/create', {
    method: 'POST',
    body: {
      title: 'Tiled 1200',
      width: 1_200,
      height: 1_200,
      tileSize: 32,
      palette: ['#000000', '#ffffff'],
      tiles: tiledPayload(1_200, 1_200),
    },
  });
  assert.equal(tiled.response.status, 201);
  assert.equal(tiled.json.storage_mode, 'tiled');
  assert.equal(tiled.json.cells.length, 0, 'tiled template must not return a full legacy map');
  const tiledId = tiled.json.id;
  const tiledManifest = await request(`/colorings/${tiledId}/manifest`);
  assert.equal(tiledManifest.response.status, 200);
  assert.equal(tiledManifest.json.grid.storage_mode, 'tiled');
  assert.equal(tiledManifest.json.grid.tiles_x, 38);
  const tiledTile = await request(`/colorings/${tiledId}/tiles/37/37`);
  assert.equal(tiledTile.response.status, 200);
  assert.equal(tiledTile.json.tile.width, 16);
  assert.equal(tiledTile.json.filled.every((value) => value === -1), true);
  const tiledProgress = await request(`/colorings/${tiledId}/progress`);
  assert.equal(tiledProgress.json.total_cells, 1_200 * 1_200);
  assert.equal('filled' in tiledProgress.json, false);
  const tiledAction = await request(`/colorings/${tiledId}/progress/actions`, {
    method: 'POST',
    body: { revision: 0, clientBatchId: 'tiled-contract-001', changes: [{ index: 0, color: 0 }] },
  });
  assert.equal(tiledAction.response.status, 200);
  assert.equal(tiledAction.json.revision, 1);
  const tiledReplay = await request(`/colorings/${tiledId}/progress/actions`, {
    method: 'POST',
    body: { revision: 0, clientBatchId: 'tiled-contract-001', changes: [{ index: 0, color: 0 }] },
  });
  assert.equal(tiledReplay.response.status, 200);
  assert.equal(tiledReplay.json.idempotent, true);
  const tiledTileAfterAction = await request(`/colorings/${tiledId}/tiles/0/0`);
  assert.equal(tiledTileAfterAction.json.filled[0], 0);

  const concurrentTiled = await request('/colorings/create', {
    method: 'POST',
    body: {
      title: 'Concurrent tiled first write',
      storageMode: 'tiled',
      width: 8,
      height: 8,
      tileSize: 32,
      palette: ['#000000', '#ffffff'],
      tiles: [{ tile_x: 0, tile_y: 0, width: 8, height: 8, cells: Array(64).fill(0) }],
    },
  });
  assert.equal(concurrentTiled.response.status, 201);
  const concurrentBodies = [
    { revision: 0, clientBatchId: 'tiled-concurrent-first-a', changes: [{ index: 0, color: 0 }] },
    { revision: 0, clientBatchId: 'tiled-concurrent-first-b', changes: [{ index: 1, color: 0 }] },
  ];
  const concurrentResults = await Promise.all(concurrentBodies.map((body) => request(
    `/colorings/${concurrentTiled.json.id}/progress/actions`,
    { method: 'POST', body },
  )));
  assert.deepEqual(
    concurrentResults.map((entry) => entry.response.status).sort(),
    [200, 409],
    'exactly one concurrent initial tiled action must win revision 0',
  );
  const concurrentProgress = await request(`/colorings/${concurrentTiled.json.id}/progress`);
  assert.equal(concurrentProgress.json.revision, 1);
  assert.equal(concurrentProgress.json.completed_cells, 1);

  const completableTiled = await request('/colorings/create', {
    method: 'POST',
    body: {
      title: 'Completable tiled contract',
      storageMode: 'tiled',
      width: 8,
      height: 8,
      tileSize: 32,
      palette: ['#000000', '#ffffff'],
      tiles: [{ tile_x: 0, tile_y: 0, width: 8, height: 8, cells: Array(64).fill(0) }],
    },
  });
  assert.equal(completableTiled.response.status, 201);
  const completableId = completableTiled.json.id;
  const completedTiled = await request(`/colorings/${completableId}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'tiled-completion-contract-001',
      changes: Array.from({ length: 64 }, (_, index) => ({ index, color: 0 })),
    },
  });
  assert.equal(completedTiled.response.status, 200);
  assert.equal(completedTiled.json.percent, 100);
  assert.ok(completedTiled.json.artwork_id);
  // The completion request must not wait for canonical rendering: it commits
  // progress + artwork metadata + the render job and returns a bounded
  // response while the outbox worker renders outside the transaction.
  assert.equal(completedTiled.json.render_status, 'pending');
  assert.equal(completedTiled.json.result_preview_data_url, null);
  const readyProgress = await waitFor(async () => {
    const progress = await request(`/colorings/${completableId}/progress`);
    if (progress.response.status !== 200) return null;
    return progress.json.render_status === 'ready' ? progress.json : null;
  });
  assert.equal(readyProgress.render_status, 'ready');
  assert.match(readyProgress.result_preview_data_url, /^data:image\/png;base64,/);
  const replayTiled = await request(`/colorings/${completableId}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'tiled-completion-contract-001',
      changes: Array.from({ length: 64 }, (_, index) => ({ index, color: 0 })),
    },
  });
  assert.equal(replayTiled.response.status, 200);
  assert.equal(replayTiled.json.idempotent, true);
  assert.equal(replayTiled.json.artwork_id, completedTiled.json.artwork_id);
  assert.deepEqual(replayTiled.json.rewards, completedTiled.json.rewards);
  assert.ok((completedTiled.json.rewards?.xp_awarded || 0) >= 40, 'completion includes the completion XP reward');
  const artworksAfterReplay = await request(`/colorings/${completableId}/progress`);
  assert.equal(artworksAfterReplay.json.artwork_id, completedTiled.json.artwork_id);
  const privateResult = await request(`/colorings/${completableId}/result`);
  assert.equal(privateResult.response.status, 200);
  assert.equal(privateResult.response.headers.get('content-type'), 'image/png');
  assert.equal((await privateResult.response.arrayBuffer()).byteLength > 32, true);
  const deniedPrivateResult = await request(`/colorings/${completableId}/result`, { userId: 'user_lenaart' });
  assert.equal(deniedPrivateResult.response.status, 404);
  assert.equal(artworksAfterReplay.json.completion_reward_xp, 40);
  // Repeated GET progress must stay bounded and stable after the artwork is
  // ready (the source-level guard in tiled-render-architecture.test.js
  // additionally forbids tile reads/renders in the progress read path).
  const repeated = await Promise.all([
    request(`/colorings/${completableId}/progress`),
    request(`/colorings/${completableId}/progress`),
    request(`/colorings/${completableId}/progress`),
  ]);
  for (const entry of repeated) {
    assert.equal(entry.response.status, 200);
    assert.equal(entry.json.render_status, 'ready');
    assert.match(entry.json.result_preview_data_url, /^data:image\/png;base64,/);
  }
  const published = await request('/posts/create', {
    method: 'POST',
    body: {
      artworkId: completedTiled.json.artwork_id,
      title: 'Published tiled completion',
      caption: 'A completed tiled map',
      commentsEnabled: true,
    },
  });
  assert.equal(published.response.status, 201);
  assert.match(published.json.artwork.image_url, /^\/media\//);
  const media = await request(published.json.artwork.image_url);
  assert.equal(media.response.status, 200);
});
