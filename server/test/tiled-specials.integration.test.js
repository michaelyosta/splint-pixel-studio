import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { getSparkExperimentGroup, isSparkTreatmentUser, SPECIAL_GAMEPLAY_GENERATION_VERSION, SPARK_PITY_INTERVAL_CELLS } from '../services/tiled-specials.js';

const userId = 'user_spark_integration';
const serverCwd = basename(process.cwd()).toLowerCase() === 'server' ? process.cwd() : join(process.cwd(), 'server');
const portBase = 32100 + (process.pid % 500);
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

function createTelegramClient(baseUrl, initData) {
  return async function request(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    return { response, json };
  };
}

function buildValidTelegramInitData(userObj, botToken, overrides = {}) {
  const data = {
    query_id: 'AAHdF6iqAAAAAN0X6Ko',
    user: JSON.stringify(userObj),
    auth_date: String(Math.floor(Date.now() / 1000)),
    hash: '',
    ...overrides,
  };
  const params = new URLSearchParams(data);
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

async function waitForServer(child) {
  await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Spark integration server did not start${stderr ? `: ${stderr}` : ''}`)), 60_000);
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
      reject(new Error(`Spark integration server exited before start (code=${code}, signal=${signal})${stderr ? `: ${stderr}` : ''}`));
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
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
    }, 3_000).unref?.();
  });
}

async function startServer(t, cohort, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'splint-spark-'));
  const port = nextPort();
  const env = {
    ...process.env,
    DATABASE_URL: '',
    PORT: String(port),
    SQLITE_DB_PATH: join(directory, 'test.db.bin'),
    MEDIA_STORAGE_ROOT: join(directory, 'uploads'),
    NODE_ENV: options.nodeEnv || 'test',
    ALLOW_DEV_AUTH: options.allowDevAuth === undefined ? 'true' : String(options.allowDevAuth),
    SPECIAL_CELLS_COHORT: cohort,
    SPECIAL_CELLS_QA_OVERRIDE: 'true',
    SPECIAL_CELLS_QA_USER_ID: 'user_spark_integration,user_tiled_trivial,user_reload_recovery,user_reload_skip,user_two_device_offer,user_tiled_control,tg_424242',
    SPECIAL_CELLS_DIAGNOSTICS: options.diagnostics === false ? 'false' : 'true',
    TELEGRAM_BOT_TOKEN: options.telegramBotToken || '',
    RATE_LIMIT_MAX: '10000',
    RENDER_OUTBOX_ENABLED: 'false',
    ...(options.e2eHooks ? { E2E_SEED_HOOKS: 'true' } : {}),
  };
  const child = spawn('node', ['index.js'], {
    cwd: serverCwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    await stopChild(child);
    await rm(directory, { recursive: true, force: true });
  });
  await waitForServer(child);
  return `http://127.0.0.1:${port}`;
}

async function findFirstSpark(request, id) {
  let spark = null;
  for (let tileY = 0; tileY < 2 && !spark; tileY += 1) {
    for (let tileX = 0; tileX < 2 && !spark; tileX += 1) {
      const tile = await request(`/colorings/${id}/tiles/${tileX}/${tileY}`);
      assert.equal(tile.response.status, 200);
      spark = (tile.json.specials || []).find((special) => special.kind === 'spark') || null;
    }
  }
  return spark;
}

test('Spark claim/use is server-authoritative, bounded, and idempotent', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT');
  const request = createClient(baseUrl, userId);

  const created = await request('/colorings/create', {
    method: 'POST',
    body: {
      title: 'Spark integration',
      storageMode: 'tiled',
      width: 64,
      height: 64,
      tileSize: 32,
      palette: ['#101820', '#ffffff'],
      tiles: tiledPayload(64, 64),
    },
  });
  assert.equal(created.response.status, 201);
  const id = created.json.id;

  const initialProgress = await request(`/colorings/${id}/progress`);
  assert.equal(initialProgress.response.status, 200);
  assert.equal(initialProgress.json.specials_experiment_group, 'treatment');
  assert.equal(initialProgress.json.special_diagnostics.cohort, 'treatment');
  assert.equal(initialProgress.json.special_diagnostics.cohort_override, true);
  assert.equal(initialProgress.json.special_diagnostics.placement_version, SPECIAL_GAMEPLAY_GENERATION_VERSION);
  assert.equal(initialProgress.json.special_diagnostics.template_id, id);
  assert.equal(initialProgress.json.special_diagnostics.template_width, 64);
  assert.equal(initialProgress.json.special_diagnostics.template_height, 64);
  assert.equal(initialProgress.json.special_diagnostics.storage_mode, 'tiled');
  assert.equal(initialProgress.json.special_diagnostics.total_candidates, 2);
  assert.equal(initialProgress.json.special_diagnostics.generation_version, SPECIAL_GAMEPLAY_GENERATION_VERSION);
  assert.equal(initialProgress.json.special_diagnostics.special_count, 2);
  assert.deepEqual(Object.keys(initialProgress.json.special_diagnostics.counts_by_kind).sort(), [
    'artifact', 'bomb', 'choice', 'fuse', 'hazard', 'spark',
  ]);
  assert.equal(
    Object.values(initialProgress.json.special_diagnostics.counts_by_kind)
      .reduce((sum, count) => sum + Number(count || 0), 0),
    initialProgress.json.special_diagnostics.special_count,
  );
  assert.deepEqual(initialProgress.json.special_diagnostics.counts_by_status, {
    unseen: 2, offered: 0, consumed: 0, skipped: 0,
  });
  assert.equal(initialProgress.json.special_diagnostics.completed_cells, 0);
  assert.equal(initialProgress.json.special_diagnostics.total_cells, 64 * 64);
  assert.equal(initialProgress.json.special_diagnostics.completed, false);
  assert.equal(initialProgress.json.special_diagnostics.completed_at, null);
  assert.equal(initialProgress.json.special_diagnostics.active_special_id, null);
  assert.equal(initialProgress.json.special_diagnostics.pity_due, true);
  assert.equal(initialProgress.json.special_diagnostics.cells_to_next_pity_boundary, SPARK_PITY_INTERVAL_CELLS);
  assert.deepEqual(initialProgress.json.special_diagnostics.recent, []);

  const spark = await findFirstSpark(request, id);
  assert.ok(spark, 'created tiled template exposes a Spark marker');

  const claimBody = {
    revision: 0,
    clientBatchId: 'spark-claim-001',
    changes: [{ index: spark.cell_index, color: 0 }],
    special_action: { type: 'claim_spark', special_id: spark.id },
  };
  const claimed = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: claimBody });
  assert.equal(claimed.response.status, 200);
  assert.equal(claimed.json.special_offer.target_options.length, 1);
  assert.equal(claimed.json.special_offer.default_option_id, claimed.json.special_offer.target_options[0].option_id);
  assert.equal(claimed.json.special_offer.auto_apply, true);
  assert.equal(claimed.json.special_offer.interaction_cost, 0);
  assert.ok(claimed.json.special_offer.offer_token);
  assert.equal(claimed.json.special_applied_changes.length, 0);
  assert.equal(claimed.json.special_diagnostics.active_special_id, spark.id);
  assert.equal(claimed.json.special_diagnostics.counts_by_status.offered, 1);
  assert.equal(claimed.json.special_diagnostics.counts_by_status.unseen, 1);

  const claimReplay = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: claimBody });
  assert.equal(claimReplay.response.status, 200);
  assert.equal(claimReplay.json.idempotent, true);
  assert.equal(claimReplay.json.special_offer.offer_token, claimed.json.special_offer.offer_token);
  assert.equal(claimReplay.json.special_diagnostics.active_special_id, spark.id);

  const useBody = {
    revision: claimed.json.revision,
    clientBatchId: 'spark-use-001',
    changes: [],
    special_action: {
      type: 'use_spark',
      special_id: spark.id,
      offer_token: claimed.json.special_offer.offer_token,
      option_id: claimed.json.special_offer.target_options[0].option_id,
      camera_center: { x: 63, y: 63 },
    },
  };
  const used = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: useBody });
  assert.equal(used.response.status, 200);
  assert.equal(
    used.json.special_applied_changes.length,
    claimed.json.special_offer.target_options[0].estimated_cells,
  );
  assert.ok(used.json.special_applied_changes.length > 32);
  const selectedBounds = claimed.json.special_offer.target_options[0].bounds;
  assert.ok(used.json.special_applied_changes.every(({ index }) => {
    const x = Number(index) % 64;
    const y = Math.floor(Number(index) / 64);
    return x >= selectedBounds.min_x && x <= selectedBounds.max_x
      && y >= selectedBounds.min_y && y <= selectedBounds.max_y;
  }), 'forged camera_center cannot move the persisted server target');
  assert.equal(used.json.special_diagnostics.counts_by_status.consumed, 1);
  assert.equal(used.json.special_diagnostics.active_special_id, null);

  const useReplay = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: useBody });
  assert.equal(useReplay.response.status, 200);
  assert.equal(useReplay.json.idempotent, true);

  const duplicateUse = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: { ...useBody, clientBatchId: 'spark-use-002', revision: used.json.revision },
  });
  assert.equal(duplicateUse.response.status, 409);
  assert.equal(duplicateUse.json.code, 'SPECIAL_OFFER_STALE');

  const skipTemplate = await request('/colorings/create', {
    method: 'POST',
    body: {
      title: 'Spark skip flow',
      storageMode: 'tiled',
      width: 64,
      height: 64,
      tileSize: 32,
      palette: ['#101820', '#ffffff'],
      tiles: tiledPayload(64, 64),
    },
  });
  assert.equal(skipTemplate.response.status, 201);
  const skipId = skipTemplate.json.id;
  const skipSpark = await findFirstSpark(request, skipId);
  assert.ok(skipSpark);
  const skipClaim = await request(`/colorings/${skipId}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'spark-skip-claim-001',
      changes: [{ index: skipSpark.cell_index, color: 0 }],
      special_action: { type: 'claim_spark', special_id: skipSpark.id },
    },
  });
  assert.equal(skipClaim.response.status, 200);
  assert.equal(skipClaim.json.special_diagnostics.active_special_id, skipSpark.id);
  assert.equal(skipClaim.json.special_diagnostics.counts_by_status.offered, 1);
  const skipped = await request(`/colorings/${skipId}/progress/actions`, {
    method: 'POST',
    body: {
      revision: skipClaim.json.revision,
      clientBatchId: 'spark-skip-001',
      changes: [],
      special_action: {
        type: 'skip_spark',
        special_id: skipSpark.id,
        offer_token: skipClaim.json.special_offer.offer_token,
      },
    },
  });
  assert.equal(skipped.response.status, 200);
  assert.equal(skipped.json.special_diagnostics.counts_by_status.skipped, 1);
  assert.equal(skipped.json.special_diagnostics.active_special_id, null);

  const prepaintedTemplate = await request('/colorings/create', {
    method: 'POST',
    body: {
      title: 'Spark already painted guard',
      storageMode: 'tiled',
      width: 64,
      height: 64,
      tileSize: 32,
      palette: ['#101820', '#ffffff'],
      tiles: tiledPayload(64, 64),
    },
  });
  assert.equal(prepaintedTemplate.response.status, 201);
  const prepaintedSpark = await findFirstSpark(request, prepaintedTemplate.json.id);
  assert.ok(prepaintedSpark);
  const ordinaryPaint = await request(`/colorings/${prepaintedTemplate.json.id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'spark-prepaint-001',
      changes: [{ index: prepaintedSpark.cell_index, color: 0 }],
    },
  });
  assert.equal(ordinaryPaint.response.status, 200);
  const lateClaim = await request(`/colorings/${prepaintedTemplate.json.id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: ordinaryPaint.json.revision,
      clientBatchId: 'spark-prepaint-claim-001',
      changes: [{ index: prepaintedSpark.cell_index, color: 0 }],
      special_action: { type: 'claim_spark', special_id: prepaintedSpark.id },
    },
  });
  assert.equal(lateClaim.response.status, 409);
  assert.equal(lateClaim.json.code, 'SPECIAL_CLAIM_INVALID');
});

test('tiled one-cell trigger is committed without any Special offer or effect', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT');
  const request = createClient(baseUrl, 'user_tiled_trivial');
  const created = await request('/colorings/create', {
    method: 'POST',
    body: {
      title: 'Tiled trivial Spark guard',
      storageMode: 'tiled',
      width: 64,
      height: 64,
      tileSize: 32,
      palette: ['#101820', '#ffffff'],
      tiles: tiledPayload(64, 64),
    },
  });
  assert.equal(created.response.status, 201);
  const id = created.json.id;
  const spark = await findFirstSpark(request, id);
  assert.ok(spark);

  const localX = spark.local_index % 32;
  const localY = Math.floor(spark.local_index / 32);
  const minLocalX = Math.max(0, localX - 6);
  const minLocalY = Math.max(0, localY - 6);
  const maxLocalX = Math.min(31, minLocalX + 11);
  const maxLocalY = Math.min(31, minLocalY + 11);
  const globalX = spark.cell_index % 64;
  const globalY = Math.floor(spark.cell_index / 64);
  const offsetX = globalX - localX;
  const offsetY = globalY - localY;
  const localWindow = [];
  for (let y = minLocalY; y <= maxLocalY; y += 1) {
    for (let x = minLocalX; x <= maxLocalX; x += 1) {
      const index = (offsetY + y) * 64 + offsetX + x;
      if (index !== spark.cell_index) localWindow.push(index);
    }
  }

  let revision = 0;
  for (let offset = 0; offset < localWindow.length; offset += 64) {
    const painted = await request(`/colorings/${id}/progress/actions`, {
      method: 'POST',
      body: {
        revision,
        clientBatchId: `tiled-trivial-setup-${offset}`,
        changes: localWindow.slice(offset, offset + 64).map((index) => ({ index, color: 0 })),
      },
    });
    assert.equal(painted.response.status, 200);
    revision = painted.json.revision;
  }

  const claimBody = {
    revision,
    clientBatchId: 'tiled-trivial-claim',
    changes: [{ index: spark.cell_index, color: 0 }],
    special_action: { type: 'claim_spark', special_id: spark.id },
  };
  const claimed = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: claimBody });
  assert.equal(claimed.response.status, 200);
  assert.equal(claimed.json.special_effort.trigger_target.estimated_cells, 1);
  assert.equal(claimed.json.special_effort.suppression_reason, 'trivial_trigger_target');
  assert.equal(claimed.json.special_offer, null);
  assert.deepEqual(claimed.json.special_applied_changes, []);
  assert.equal(claimed.json.special_discovered, null);
  assert.ok(claimed.json.percent < 100);

  const replay = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: claimBody });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.json.idempotent, true);
  assert.equal(replay.json.special_effort.suppression_reason, 'trivial_trigger_target');
  const after = await request(`/colorings/${id}/progress`);
  assert.equal(
    after.json.special_diagnostics.target_effort_distribution.trigger_targets.sample_count,
    1,
  );
  assert.equal(
    after.json.special_diagnostics.target_effort_distribution.trigger_targets.bins['1'],
    1,
  );
});

test('reload recovers the persisted Spark offer and the recovered token is usable once', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT');
  const request = createClient(baseUrl, 'user_reload_recovery');

  const created = await request('/colorings/create', {
    method: 'POST',
    body: {
      title: 'Spark reload recovery',
      storageMode: 'tiled',
      width: 64,
      height: 64,
      tileSize: 32,
      palette: ['#101820', '#ffffff'],
      tiles: tiledPayload(64, 64),
    },
  });
  assert.equal(created.response.status, 201);
  const id = created.json.id;
  const spark = await findFirstSpark(request, id);
  assert.ok(spark);

  const prematureGuidance = await request(
    `/colorings/${id}/guidance?reason=SPECIAL_TARGETS&special_id=${encodeURIComponent(spark.id)}`,
  );
  assert.equal(prematureGuidance.response.status, 409);
  assert.equal(prematureGuidance.json.code, 'SPECIAL_TARGET_OFFER_REQUIRED');
  assert.equal('offer_token' in prematureGuidance.json, false);

  const claimBody = {
    revision: 0,
    clientBatchId: 'reload-claim-001',
    changes: [{ index: spark.cell_index, color: 0 }],
    special_action: { type: 'claim_spark', special_id: spark.id },
  };
  const claimed = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: claimBody });
  assert.equal(claimed.response.status, 200);
  assert.ok(claimed.json.special_offer.offer_token);

  const blockedGuidance = await request(`/colorings/${id}/guidance?reason=SAME_COLOR_NEXT`);
  assert.equal(blockedGuidance.response.status, 409);
  assert.equal(blockedGuidance.json.code, 'SPECIAL_ACTIVE_OFFER');
  const allowedGuidance = await request(
    `/colorings/${id}/guidance?reason=SPECIAL_TARGETS&special_id=${encodeURIComponent(spark.id)}`,
  );
  assert.equal(allowedGuidance.response.status, 200);
  assert.equal(allowedGuidance.json.reason, 'SPECIAL_TARGETS');

  const reloaded = await request(`/colorings/${id}/progress`);
  assert.equal(reloaded.response.status, 200);
  assert.equal(reloaded.json.revision, claimed.json.revision);
  assert.ok(reloaded.json.special_offer, 'reload restores the persisted offer');
  assert.equal(reloaded.json.special_offer.offer_token, claimed.json.special_offer.offer_token);
  assert.deepEqual(reloaded.json.special_offer.target_options, claimed.json.special_offer.target_options);
  assert.equal(reloaded.json.special_offer.progress_revision, claimed.json.special_offer.progress_revision);
  assert.equal(reloaded.json.special_diagnostics.active_special_id, spark.id);
  assert.equal(reloaded.json.special_diagnostics.counts_by_status.offered, 1);

  const secondReload = await request(`/colorings/${id}/progress`);
  assert.equal(secondReload.json.special_offer.offer_token, claimed.json.special_offer.offer_token,
    'reload is read-only and does not rotate the token');

  const useBody = {
    revision: reloaded.json.revision,
    clientBatchId: 'reload-use-001',
    changes: [],
    special_action: {
      type: 'use_spark',
      special_id: spark.id,
      offer_token: reloaded.json.special_offer.offer_token,
      option_id: reloaded.json.special_offer.target_options[0].option_id,
    },
  };
  const used = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: useBody });
  assert.equal(used.response.status, 200);
  assert.equal(
    used.json.special_applied_changes.length,
    reloaded.json.special_offer.target_options[0].estimated_cells,
  );
  assert.ok(used.json.special_applied_changes.length > 32);
  assert.equal(used.json.special_diagnostics.counts_by_status.consumed, 1);

  const afterUse = await request(`/colorings/${id}/progress`);
  assert.equal(afterUse.response.status, 200);
  assert.equal(afterUse.json.special_offer, null);
  assert.equal(afterUse.json.special_diagnostics.active_special_id, null);
  assert.equal(afterUse.json.special_diagnostics.counts_by_status.consumed, 1);
});

test('recovered Spark offer can be skipped and disappears from reload', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT');
  const request = createClient(baseUrl, 'user_reload_skip');

  const created = await request('/colorings/create', {
    method: 'POST',
    body: {
      title: 'Spark reload skip',
      storageMode: 'tiled',
      width: 64,
      height: 64,
      tileSize: 32,
      palette: ['#101820', '#ffffff'],
      tiles: tiledPayload(64, 64),
    },
  });
  assert.equal(created.response.status, 201);
  const id = created.json.id;
  const spark = await findFirstSpark(request, id);
  assert.ok(spark);

  const claimed = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'reload-skip-claim-001',
      changes: [{ index: spark.cell_index, color: 0 }],
      special_action: { type: 'claim_spark', special_id: spark.id },
    },
  });
  assert.equal(claimed.response.status, 200);

  const reloaded = await request(`/colorings/${id}/progress`);
  assert.equal(reloaded.response.status, 200);
  assert.equal(reloaded.json.special_diagnostics.counts_by_status.offered, 1);
  assert.ok(reloaded.json.special_offer);

  const reloadedProgress = await request(`/colorings/${id}/progress`);
  assert.equal(reloadedProgress.response.status, 200);
  assert.equal(reloadedProgress.json.special_diagnostics.active_special_id, spark.id);

  const skipped = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: reloadedProgress.json.revision,
      clientBatchId: 'reload-skip-001',
      changes: [],
      special_action: {
        type: 'skip_spark',
        special_id: spark.id,
        offer_token: reloaded.json.special_offer.offer_token,
      },
    },
  });
  assert.equal(skipped.response.status, 200);
  assert.equal(skipped.json.special_diagnostics.counts_by_status.skipped, 1);
  assert.equal(skipped.json.special_diagnostics.active_special_id, null);

  const afterSkip = await request(`/colorings/${id}/progress`);
  assert.equal(afterSkip.response.status, 200);
  assert.equal(afterSkip.json.special_offer, null);
  assert.equal(afterSkip.json.special_diagnostics.active_special_id, null);
});

test('two devices using the recovered offer apply exactly one effect and consume once', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT');
  const request = createClient(baseUrl, 'user_two_device_offer');

  const created = await request('/colorings/create', {
    method: 'POST',
    body: {
      title: 'Spark two-device offer',
      storageMode: 'tiled',
      width: 64,
      height: 64,
      tileSize: 32,
      palette: ['#101820', '#ffffff'],
      tiles: tiledPayload(64, 64),
    },
  });
  assert.equal(created.response.status, 201);
  const id = created.json.id;
  const spark = await findFirstSpark(request, id);
  assert.ok(spark);

  const claimed = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'two-device-claim-001',
      changes: [{ index: spark.cell_index, color: 0 }],
      special_action: { type: 'claim_spark', special_id: spark.id },
    },
  });
  assert.equal(claimed.response.status, 200);

  const reloaded = await request(`/colorings/${id}/progress`);
  const offer = reloaded.json.special_offer;
  assert.ok(offer);
  const useBody = (clientBatchId, revision) => ({
    revision,
    clientBatchId,
    changes: [],
    special_action: {
      type: 'use_spark',
      special_id: spark.id,
      offer_token: offer.offer_token,
      option_id: offer.target_options[0].option_id,
    },
  });

  const firstUse = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: useBody('two-device-use-a', reloaded.json.revision),
  });
  assert.equal(firstUse.response.status, 200);
  assert.ok(firstUse.json.special_applied_changes.length > 0);

  const staleRevisionUse = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: useBody('two-device-use-b', reloaded.json.revision),
  });
  assert.equal(staleRevisionUse.response.status, 409);

  const staleOfferUse = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: useBody('two-device-use-b', firstUse.json.revision),
  });
  assert.equal(staleOfferUse.response.status, 409);
  assert.equal(staleOfferUse.json.code, 'SPECIAL_OFFER_STALE');

  const after = await request(`/colorings/${id}/progress`);
  assert.equal(after.response.status, 200);
  assert.equal(after.json.completed_cells, firstUse.json.completed_cells);
  assert.equal(after.json.special_diagnostics.counts_by_status.consumed, 1);
  assert.equal(after.json.special_diagnostics.active_special_id, null);
  assert.equal(after.json.special_offer, null);
});

test('tiled control cohort exposes no specials and no gameplay diagnostics', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_CONTROL');
  const request = createClient(baseUrl, 'user_tiled_control');

  const created = await request('/colorings/create', {
    method: 'POST',
    body: {
      title: 'Spark control',
      storageMode: 'tiled',
      width: 64,
      height: 64,
      tileSize: 32,
      palette: ['#101820', '#ffffff'],
      tiles: tiledPayload(64, 64),
    },
  });
  assert.equal(created.response.status, 201);
  const id = created.json.id;

  const progress = await request(`/colorings/${id}/progress`);
  assert.equal(progress.response.status, 200);
  assert.equal(progress.json.specials_experiment_group, 'control');
  assert.equal(progress.json.special_offer, null);
  assert.deepEqual(Object.keys(progress.json.special_diagnostics).sort(), [
    'active_special_id',
    'cells_to_next_pity_boundary',
    'cohort',
    'cohort_override',
    'completed',
    'completed_at',
    'completed_cells',
    'counts_by_kind',
    'counts_by_status',
    'generation_action',
    'generation_count',
    'generation_elapsed_ms',
    'generation_version',
    'pity_due',
    'placement_version',
    'recent',
    'special_count',
    'storage_mode',
    'target_effort_contract',
    'target_effort_distribution',
    'template_height',
    'template_id',
    'template_width',
    'total_candidates',
    'total_cells',
  ]);
  assert.equal(progress.json.special_diagnostics.target_effort_distribution.trigger_targets.sample_count, 0);
  assert.equal(progress.json.special_diagnostics.target_effort_distribution.selected_effect_targets.sample_count, 0);
  const rejectedTargets = await request(
    `/colorings/${id}/guidance?reason=SPECIAL_TARGETS&special_id=sc_forged_control`,
  );
  assert.equal(rejectedTargets.response.status, 403);
  assert.equal(rejectedTargets.json.code, 'SPECIAL_TARGETS_CONTROL');
  assert.equal('offer_token' in rejectedTargets.json, false);
  assert.equal(progress.json.special_diagnostics.cohort, 'control');
  assert.equal(progress.json.special_diagnostics.cohort_override, true);
  assert.deepEqual(progress.json.special_diagnostics.counts_by_kind, {
    artifact: 0,
    bomb: 0,
    choice: 0,
    fuse: 0,
    hazard: 1,
    spark: 1,
  });
  assert.equal(progress.json.special_diagnostics.special_count, 2);
  assert.deepEqual(progress.json.special_diagnostics.counts_by_status, {
    unseen: 2, offered: 0, consumed: 0, skipped: 0,
  });
  assert.equal(progress.json.special_diagnostics.active_special_id, null);
  assert.equal(progress.json.special_diagnostics.pity_due, false);
  assert.equal(progress.json.special_diagnostics.cells_to_next_pity_boundary, SPARK_PITY_INTERVAL_CELLS);
  assert.equal(progress.json.special_diagnostics.template_id, id);
  assert.equal(progress.json.special_diagnostics.storage_mode, 'tiled');
  assert.equal(progress.json.special_diagnostics.total_candidates, 2);
  assert.equal(progress.json.special_diagnostics.total_cells, 64 * 64);
  assert.deepEqual(progress.json.special_diagnostics.recent, []);

  const tile = await request(`/colorings/${id}/tiles/0/0`);
  assert.equal(tile.response.status, 200);
  assert.deepEqual(tile.json.specials, []);

  const forgedClaim = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'tiled-forged-claim-001',
      changes: [{ index: 0, color: 0 }],
      special_action: { type: 'claim_spark', special_id: 'sc_forged_claim' },
    },
  });
  assert.equal(forgedClaim.response.status, 404);
  assert.equal(forgedClaim.json.code, 'SPECIAL_COHORT_CONTROL');
});

test('manual override is inert when dev auth is disabled, preserving deterministic assignment', async (t) => {
  const botToken = '1234567890:ABCdefGHIjklMNOpqrsTUVwxyz';
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT', {
    allowDevAuth: false,
    telegramBotToken: botToken,
  });
  const initData = buildValidTelegramInitData({
    id: 424242,
    first_name: 'Override Inert',
    username: 'override_inert',
  }, botToken);
  const request = createTelegramClient(baseUrl, initData);

  const created = await request('/colorings/create', {
    method: 'POST',
    body: {
      title: 'Override inert gate',
      storageMode: 'tiled',
      width: 64,
      height: 64,
      tileSize: 32,
      palette: ['#101820', '#ffffff'],
      tiles: tiledPayload(64, 64),
    },
  });
  assert.equal(created.response.status, 201);
  const id = created.json.id;

  const progress = await request(`/colorings/${id}/progress`);
  assert.equal(progress.response.status, 200);
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    allowDevAuth: process.env.ALLOW_DEV_AUTH,
    cohort: process.env.SPECIAL_CELLS_COHORT,
  };
  try {
    delete process.env.NODE_ENV;
    delete process.env.ALLOW_DEV_AUTH;
    delete process.env.SPECIAL_CELLS_COHORT;
    assert.equal(
      progress.json.specials_experiment_group,
      getSparkExperimentGroup('tg_424242', id),
      'override must not force treatment when dev auth is disabled',
    );
    assert.equal('special_diagnostics' in progress.json, false);
    assert.equal(
      progress.json.specials_experiment_group,
      getSparkExperimentGroup('tg_424242', id),
    );
  } finally {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.allowDevAuth === undefined) delete process.env.ALLOW_DEV_AUTH; else process.env.ALLOW_DEV_AUTH = previous.allowDevAuth;
    if (previous.cohort === undefined) delete process.env.SPECIAL_CELLS_COHORT; else process.env.SPECIAL_CELLS_COHORT = previous.cohort;
  }
});

test('ordinary dev responses omit diagnostics unless the explicit flag is enabled', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT', { diagnostics: false });
  const request = createClient(baseUrl, 'user_spark_integration');

  const created = await request('/colorings/create', {
    method: 'POST',
    body: {
      title: 'Diagnostics omitted',
      storageMode: 'tiled',
      width: 64,
      height: 64,
      tileSize: 32,
      palette: ['#101820', '#ffffff'],
      tiles: tiledPayload(64, 64),
    },
  });
  assert.equal(created.response.status, 201);
  const id = created.json.id;

  const progress = await request(`/colorings/${id}/progress`);
  assert.equal(progress.response.status, 200);
  assert.equal('special_diagnostics' in progress.json, false);
  assert.ok(progress.json.specials_experiment_group);
});

test('override applies only to the allowlisted QA user', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT');
  const allowed = createClient(baseUrl, 'user_spark_integration');
  const outsider = createClient(baseUrl, 'user_qa_outsider');

  const createTemplate = async (request, title) => {
    const created = await request('/colorings/create', {
      method: 'POST',
      body: {
        title,
        storageMode: 'tiled',
        width: 64,
        height: 64,
        tileSize: 32,
        palette: ['#101820', '#ffffff'],
        tiles: tiledPayload(64, 64),
      },
    });
    assert.equal(created.response.status, 201);
    return created.json.id;
  };

  const allowedId = await createTemplate(allowed, 'Allowed QA user');
  const outsiderId = await createTemplate(outsider, 'Outsider QA user');

  const allowedProgress = await allowed(`/colorings/${allowedId}/progress`);
  const outsiderProgress = await outsider(`/colorings/${outsiderId}/progress`);
  assert.equal(allowedProgress.response.status, 200);
  assert.equal(outsiderProgress.response.status, 200);

  assert.equal(allowedProgress.json.specials_experiment_group, 'treatment');
  assert.equal(allowedProgress.json.special_diagnostics.cohort_override, true);

  assert.equal(
    outsiderProgress.json.specials_experiment_group,
    getSparkExperimentGroup('user_qa_outsider', outsiderId),
  );
  assert.equal(outsiderProgress.json.special_diagnostics.cohort_override, false);
});

test('production startup rejects QA override and diagnostics flags', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-prod-qa-'));
  const child = spawn('node', ['index.js'], {
    cwd: serverCwd,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ALLOW_DEV_AUTH: 'false',
      SPECIAL_CELLS_QA_OVERRIDE: 'true',
      SPECIAL_CELLS_DIAGNOSTICS: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let errorOutput = '';
  child.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });
  const code = await new Promise((resolve) => child.once('exit', resolve));
  assert.notEqual(code, 0);
  assert.match(errorOutput, /SPECIAL_CELLS_QA_OVERRIDE cannot be enabled in production/);

  child.kill();
  await rm(directory, { recursive: true, force: true });
});

test('deterministic cohort seed returns the same template and cohort for repeated requests', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT', { e2eHooks: true });
  const request = createClient(baseUrl, 'user_cohort_seed');

  const first = await request('/__e2e/seed-cohort-template', {
    method: 'POST',
    body: { cohort: 'treatment', storage: 'tiled', size: { width: 64, height: 64 } },
  });
  assert.equal(first.response.status, 201);
  assert.equal(first.json.cohort, 'treatment');
  assert.equal(first.json.specials_experiment_group, 'treatment');
  assert.equal(first.json.storage, 'tiled');
  assert.equal(first.json.size.width, 64);
  assert.equal(first.json.size.height, 64);
  assert.equal(first.json.reused, false);

  const second = await request('/__e2e/seed-cohort-template', {
    method: 'POST',
    body: { cohort: 'treatment', storage: 'tiled', size: { width: 64, height: 64 } },
  });
  assert.equal(second.response.status, 201);
  assert.equal(second.json.id, first.json.id);
  assert.equal(second.json.specials_experiment_group, 'treatment');
  assert.equal(second.json.reused, true);

  const progress = await request(`/colorings/${first.json.id}/progress`);
  assert.equal(progress.response.status, 200);
  assert.equal(progress.json.specials_experiment_group, 'treatment');
});

test('deterministic cohort seed supports treatment and control with real assignment semantics', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT', { e2eHooks: true });
  const request = createClient(baseUrl, 'user_cohort_both');

  const treatment = await request('/__e2e/seed-cohort-template', {
    method: 'POST',
    body: { cohort: 'treatment', storage: 'legacy', size: { width: 28, height: 28 } },
  });
  assert.equal(treatment.response.status, 201);
  assert.equal(treatment.json.cohort, 'treatment');
  assert.equal(treatment.json.storage, 'legacy');
  assert.equal(
    getSparkExperimentGroup('user_cohort_both', treatment.json.id),
    'treatment',
  );

  const control = await request('/__e2e/seed-cohort-template', {
    method: 'POST',
    body: { cohort: 'control', storage: 'tiled', size: { width: 64, height: 64 } },
  });
  assert.equal(control.response.status, 201);
  assert.equal(control.json.cohort, 'control');
  assert.equal(
    getSparkExperimentGroup('user_cohort_both', control.json.id),
    'control',
  );
  assert.notEqual(control.json.id, treatment.json.id);

  const treatmentProgress = await request(`/colorings/${treatment.json.id}/progress`);
  assert.equal(treatmentProgress.json.specials_experiment_group, 'treatment');
  const controlProgress = await request(`/colorings/${control.json.id}/progress`);
  assert.equal(controlProgress.json.specials_experiment_group, 'control');
});

test('deterministic cohort seed validates cohort and owner-scopes templates', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT', { e2eHooks: true });
  const request = createClient(baseUrl, 'user_cohort_validation');

  const invalid = await request('/__e2e/seed-cohort-template', {
    method: 'POST',
    body: { cohort: 'nonsense', storage: 'tiled' },
  });
  assert.equal(invalid.response.status, 400);

  const seeded = await request('/__e2e/seed-cohort-template', {
    method: 'POST',
    body: { cohort: 'treatment', storage: 'tiled', size: { width: 64, height: 64 } },
  });
  assert.equal(seeded.response.status, 201);
  assert.equal(seeded.json.user_id, 'user_cohort_validation');
});

test('deterministic cohort seed ignores QA override and uses the real production assignment', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT', { e2eHooks: true });
  const request = createClient(baseUrl, 'user_cohort_production_semantics');

  const seeded = await request('/__e2e/seed-cohort-template', {
    method: 'POST',
    body: { cohort: 'control', storage: 'tiled', size: { width: 64, height: 64 } },
  });
  assert.equal(seeded.response.status, 201);
  assert.equal(seeded.json.cohort, 'control');
  assert.equal(
    isSparkTreatmentUser('user_cohort_production_semantics', seeded.json.id),
    false,
    'fixture id must carry the real deterministic control assignment',
  );
  assert.equal(
    getSparkExperimentGroup('user_cohort_production_semantics', seeded.json.id),
    'control',
    'the running process override is unrelated to the deterministic fixture assignment',
  );
  assert.equal(
    seeded.json.specials_experiment_group,
    'control',
    'the hook response must report the deterministic production assignment, not the QA override',
  );
});

test('cohort seed hook is unreachable without E2E_SEED_HOOKS and never persists a cohort override', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT');
  const request = createClient(baseUrl, 'user_cohort_gate');

  const missing = await request('/__e2e/seed-cohort-template', {
    method: 'POST',
    body: { cohort: 'treatment', storage: 'tiled', size: { width: 64, height: 64 } },
  });
  assert.equal(missing.response.status, 404);

  const seeded = await request('/__e2e/seed-cohort-template', {
    method: 'POST',
    body: { cohort: 'control', storage: 'tiled', size: { width: 64, height: 64 } },
  });
  assert.equal(seeded.response.status, 404);
  assert.equal(
    getSparkExperimentGroup('user_cohort_gate', 'tpl_cohort_e2e_user_cohort_gate_control_0_64x64'),
    'control',
  );
});

async function seedPreexistingSpecialTemplate(request, body) {
  const seeded = await request('/__e2e/seed-preexisting-special-template', {
    method: 'POST',
    body,
  });
  assert.equal(seeded.response.status, 201);
  return seeded.json;
}

async function findSpecialNearTile(request, id, tileX, tileY, specialId, tilesX = 38, tilesY = 38) {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const tx = tileX + dx;
      const ty = tileY + dy;
      if (tx < 0 || ty < 0 || tx >= tilesX || ty >= tilesY) continue;
      const tile = await request(`/colorings/${id}/tiles/${tx}/${ty}`);
      assert.equal(tile.response.status, 200);
      const marker = (tile.json.specials || []).find((special) => special.id === specialId);
      if (marker) return marker;
    }
  }
  return null;
}

test('pre-existing 1200 zero-row treatment materializes deterministic early special before guidance and tile reads', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT', { e2eHooks: true });
  const request = createClient(baseUrl, userId);
  const seeded = await seedPreexistingSpecialTemplate(request, {
    width: 1200,
    height: 1200,
    tileSize: 32,
    specialMode: 'none',
  });
  const id = seeded.id;
  assert.ok(seeded.rowsBefore > 0, 'fixture must remove real generated rows, not create an empty template');

  const guidance = await request(`/colorings/${id}/guidance?reason=INITIAL_TARGET`);
  assert.equal(guidance.response.status, 200);
  assert.ok(guidance.json.special_id, 'first guidance must carry the deterministic early special');
  assert.match(guidance.json.special_id, /^sc_early_/);
  assert.ok(guidance.json.target?.tile_x != null && guidance.json.target?.tile_y != null);

  const marker = await findSpecialNearTile(
    request,
    id,
    Number(guidance.json.target.tile_x),
    Number(guidance.json.target.tile_y),
    guidance.json.special_id,
  );
  assert.ok(marker, 'target tile neighborhood must expose the same marker');
  assert.equal(marker.id, guidance.json.special_id);
  assert.equal(marker.kind, 'spark');
  assert.equal(marker.state, 'unseen');

  const progress = await request(`/colorings/${id}/progress`);
  assert.equal(progress.response.status, 200);
  assert.ok(progress.json.special_diagnostics.special_count > 0);
  assert.equal(progress.json.special_diagnostics.counts_by_kind.hazard, 1);
  assert.ok(Number.isFinite(Number(progress.json.special_diagnostics.generation_elapsed_ms)));

  const guidanceAgain = await request(`/colorings/${id}/guidance?reason=INITIAL_TARGET`);
  assert.equal(guidanceAgain.response.status, 200);
  assert.equal(guidanceAgain.json.special_id, guidance.json.special_id);
  const progressAgain = await request(`/colorings/${id}/progress`);
  assert.equal(
    progressAgain.json.special_diagnostics.special_count,
    progress.json.special_diagnostics.special_count,
  );
});

test('pre-existing v3 template with user progress backfills exactly one deterministic hazard without moving rows or duplicating', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT', { e2eHooks: true });
  const request = createClient(baseUrl, userId);
  const seeded = await seedPreexistingSpecialTemplate(request, {
    width: 160,
    height: 160,
    tileSize: 32,
    specialMode: 'v3-no-hazard',
    progressUser: userId,
  });
  const id = seeded.id;
  const sharedCount = seeded.sharedRows.length;
  assert.ok(sharedCount > 0);

  const first = await request(`/colorings/${id}/progress`);
  assert.equal(first.response.status, 200);
  assert.equal(first.json.special_diagnostics.generation_action, 'hazard_backfilled');
  assert.equal(first.json.special_diagnostics.special_count, sharedCount + 1);
  assert.equal(first.json.special_diagnostics.counts_by_kind.hazard, 1);
  assert.equal(first.json.special_diagnostics.counts_by_status.consumed, 1);

  for (const row of seeded.sharedRows.slice(0, 5)) {
    const tile = await request(`/colorings/${id}/tiles/${row.tile_x}/${row.tile_y}`);
    assert.equal(tile.response.status, 200);
    const marker = (tile.json.specials || []).find((special) => special.id === row.special_id);
    assert.ok(marker, `existing marker ${row.special_id} must stay at its original tile`);
  }

  const second = await request(`/colorings/${id}/progress`);
  assert.equal(second.json.special_diagnostics.special_count, sharedCount + 1);
  assert.equal(second.json.special_diagnostics.counts_by_kind.hazard, 1);

  await Promise.all([
    request(`/colorings/${id}/progress`),
    request(`/colorings/${id}/guidance?reason=INITIAL_TARGET`),
  ]);
  const final = await request(`/colorings/${id}/progress`);
  assert.equal(final.json.special_diagnostics.special_count, sharedCount + 1);
  assert.equal(final.json.special_diagnostics.counts_by_kind.hazard, 1);
});

test('untouched v3 template rebuilds once onto the v5 no-Choice mix', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_TREATMENT', { e2eHooks: true });
  const request = createClient(baseUrl, userId);
  const seeded = await seedPreexistingSpecialTemplate(request, {
    width: 160,
    height: 160,
    tileSize: 32,
    specialMode: 'v3-no-hazard-empty',
  });
  assert.ok(seeded.sharedRows.length > 0);
  assert.ok(seeded.sharedRows.every((row) => row.generation_version === 3));

  const first = await request(`/colorings/${seeded.id}/progress`);
  assert.equal(first.response.status, 200);
  assert.equal(first.json.special_diagnostics.generation_action, 'rebuilt');
  assert.equal(first.json.special_diagnostics.generation_version, 5);
  assert.equal(first.json.special_diagnostics.counts_by_kind.hazard, 1);

  const second = await request(`/colorings/${seeded.id}/progress`);
  assert.equal(second.response.status, 200);
  assert.equal(second.json.special_diagnostics.generation_action, 'ready');
  assert.equal(second.json.special_diagnostics.generation_version, 5);
  assert.equal(second.json.special_diagnostics.special_count, first.json.special_diagnostics.special_count);
});

test('pre-existing 1200 zero-row control still strips metadata after transactional generation', async (t) => {
  const baseUrl = await startServer(t, 'SPECIALS_CONTROL', { e2eHooks: true });
  const request = createClient(baseUrl, 'user_tiled_control');
  const seeded = await seedPreexistingSpecialTemplate(request, {
    width: 1200,
    height: 1200,
    tileSize: 32,
    specialMode: 'none',
  });
  const id = seeded.id;

  const tile = await request(`/colorings/${id}/tiles/18/18`);
  assert.equal(tile.response.status, 200);
  assert.deepEqual(tile.json.specials, []);

  const progress = await request(`/colorings/${id}/progress`);
  assert.equal(progress.response.status, 200);
  assert.ok(progress.json.special_diagnostics.special_count > 0);
  assert.equal(progress.json.special_diagnostics.counts_by_kind.hazard, 1);
});
