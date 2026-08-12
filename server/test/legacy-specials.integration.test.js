import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const serverCwd = basename(process.cwd()).toLowerCase() === 'server' ? process.cwd() : join(process.cwd(), 'server');
const portBase = 32400 + (process.pid % 300);
let portOffset = 0;

function nextPort() {
  const port = portBase + portOffset;
  portOffset += 1;
  return port;
}

function legacyCells(width, height, color = 0) {
  return Array(width * height).fill(color);
}

function createClient(baseUrl, userId) {
  return async function request(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    return { response, json };
  };
}

async function waitForServer(child) {
  await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Legacy specials server did not start${stderr ? `: ${stderr}` : ''}`)), 60_000);
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
      reject(new Error(`Legacy specials server exited before start (code=${code}, signal=${signal})${stderr ? `: ${stderr}` : ''}`));
    });
  });
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

async function startServer(t, cohort) {
  const directory = await mkdtemp(join(tmpdir(), 'splint-legacy-specials-'));
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
      SPECIAL_CELLS_QA_USER_ID: 'user_legacy_treatment,user_legacy_skip,user_legacy_control,user_legacy_last_cell',
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

async function createLegacy28Template(request, title) {
  const created = await request('/colorings/create', {
    method: 'POST',
    body: {
      title,
      storageMode: 'legacy',
      width: 28,
      height: 28,
      palette: ['#101820', '#ffffff'],
      cells: legacyCells(28, 28),
    },
  });
  assert.equal(created.response.status, 201);
  return created.json.id;
}

async function claimSpark(request, id, spark, revision, clientBatchId) {
  const body = {
    revision,
    clientBatchId,
    changes: [{ index: spark.cell_index, color: 0 }],
    special_action: { type: 'claim_spark', special_id: spark.id },
  };
  const claimed = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body });
  assert.equal(claimed.response.status, 200);
  return { body, claimed };
}

test('legacy 28x28 treatment claim is exact, bounded, and idempotent', async (t) => {
  const baseUrl = await startServer(t, 'SPARK_TREATMENT');
  const request = createClient(baseUrl, 'user_legacy_treatment');

  const id = await createLegacy28Template(request, 'Legacy 28x28 treatment');
  const progress = await request(`/colorings/${id}/progress`);
  assert.equal(progress.response.status, 200);
  assert.equal(progress.json.specials_experiment_group, 'treatment');
  assert.equal(progress.json.specials.length, 1);
  assert.equal(progress.json.specials[0].kind, 'spark');
  assert.equal(progress.json.specials[0].cell_index, 435);
  assert.equal(progress.json.specials[0].state, 'unseen');
  const spark = progress.json.specials[0];

  const { body: claimBody, claimed } = await claimSpark(request, id, spark, 0, 'legacy-spark-claim-001');
  assert.deepEqual(claimed.json.special_discovered, { special_id: spark.id, kind: 'spark' });
  assert.equal(claimed.json.revision, 1);
  assert.equal(claimed.json.special_offer.target_options.length, 2);
  assert.ok(claimed.json.special_offer.offer_token);
  assert.equal(claimed.json.special_applied_changes.length, 0);

  const claimReplay = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: claimBody });
  assert.equal(claimReplay.response.status, 200);
  assert.equal(claimReplay.json.idempotent, true);
  assert.equal(claimReplay.json.special_discovered, null);
  assert.equal(claimReplay.json.special_offer.offer_token, claimed.json.special_offer.offer_token);

  const afterClaim = await request(`/colorings/${id}/progress`);
  assert.equal(afterClaim.json.specials[0].state, 'offered');

  const useBody = {
    revision: claimed.json.revision,
    clientBatchId: 'legacy-spark-use-001',
    changes: [],
    special_action: {
      type: 'use_spark',
      special_id: spark.id,
      offer_token: claimed.json.special_offer.offer_token,
      option_id: claimed.json.special_offer.target_options[0].option_id,
    },
  };
  const used = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: useBody });
  assert.equal(used.response.status, 200);
  assert.equal(
    used.json.special_applied_changes.length,
    claimed.json.special_offer.target_options[0].estimated_cells,
  );
  assert.ok(used.json.special_applied_changes.length > 32);

  const useReplay = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: useBody });
  assert.equal(useReplay.response.status, 200);
  assert.equal(useReplay.json.idempotent, true);

  const duplicateUse = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: { ...useBody, clientBatchId: 'legacy-spark-use-002', revision: used.json.revision },
  });
  assert.equal(duplicateUse.response.status, 409);
  assert.equal(duplicateUse.json.code, 'SPECIAL_OFFER_STALE');
});

test('legacy skip_spark consumes the offer and blocks re-claim', async (t) => {
  const baseUrl = await startServer(t, 'SPARK_TREATMENT');
  const request = createClient(baseUrl, 'user_legacy_skip');

  const id = await createLegacy28Template(request, 'Legacy 28x28 skip');
  const progress = await request(`/colorings/${id}/progress`);
  const spark = progress.json.specials[0];
  const { claimed } = await claimSpark(request, id, spark, 0, 'legacy-skip-claim-001');

  const skipBody = {
    revision: claimed.json.revision,
    clientBatchId: 'legacy-skip-001',
    changes: [],
    special_action: {
      type: 'skip_spark',
      special_id: spark.id,
      offer_token: claimed.json.special_offer.offer_token,
    },
  };
  const skipped = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: skipBody });
  assert.equal(skipped.response.status, 200);
  assert.equal(skipped.json.special_discovered, null);
  assert.equal(skipped.json.revision, claimed.json.revision);

  const skipReplay = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: skipBody });
  assert.equal(skipReplay.response.status, 200);
  assert.equal(skipReplay.json.idempotent, true);

  const secondClaim = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: skipped.json.revision,
      clientBatchId: 'legacy-skip-claim-002',
      changes: [{ index: spark.cell_index, color: 0 }],
      special_action: { type: 'claim_spark', special_id: spark.id },
    },
  });
  assert.equal(secondClaim.response.status, 409);
  assert.equal(secondClaim.json.code, 'SPECIAL_CLAIM_INVALID');

  const afterSkip = await request(`/colorings/${id}/progress`);
  assert.equal(afterSkip.json.specials[0].state, 'skipped');
});

test('legacy control cohort exposes no specials and rejects forged claims', async (t) => {
  const baseUrl = await startServer(t, 'SPARK_CONTROL');
  const request = createClient(baseUrl, 'user_legacy_control');

  const id = await createLegacy28Template(request, 'Legacy 28x28 control');
  const progress = await request(`/colorings/${id}/progress`);
  assert.equal(progress.response.status, 200);
  assert.equal(progress.json.specials_experiment_group, 'control');
  assert.deepEqual(progress.json.specials, []);

  const forgedClaim = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'legacy-forged-claim-001',
      changes: [{ index: 435, color: 0 }],
      special_action: { type: 'claim_spark', special_id: 'sc_early_5e43c13eb99851e3' },
    },
  });
  assert.equal(forgedClaim.response.status, 404);
  assert.equal(forgedClaim.json.code, 'SPECIAL_COHORT_CONTROL');
});

test('legacy treatment last-cell Spark completes the 28x28 template exactly once', async (t) => {
  const baseUrl = await startServer(t, 'SPARK_TREATMENT');
  const request = createClient(baseUrl, 'user_legacy_last_cell');

  const id = await createLegacy28Template(request, 'Legacy 28x28 last cell');
  const progress = await request(`/colorings/${id}/progress`);
  const spark = progress.json.specials[0];
  assert.equal(spark.cell_index, 435);

  const otherCells = Array.from({ length: 784 }, (_, index) => index)
    .filter((index) => index !== spark.cell_index);
  let revision = 0;
  const batches = [];
  for (let offset = 0; offset < otherCells.length; offset += 64) {
    const changes = otherCells.slice(offset, offset + 64).map((index) => ({ index, color: 0 }));
    assert.ok(changes.length <= 64);
    const painted = await request(`/colorings/${id}/progress/actions`, {
      method: 'POST',
      body: {
        revision,
        clientBatchId: `legacy-paint-${offset}`,
        changes,
      },
    });
    assert.equal(painted.response.status, 200);
    assert.equal(painted.json.special_discovered, null);
    revision = painted.json.revision;
    batches.push(painted);
  }
  assert.ok(batches.length <= 64, `expected at most 64 batches, got ${batches.length}`);

  const finalBody = {
    revision,
    clientBatchId: 'legacy-last-cell-claim',
    changes: [{ index: spark.cell_index, color: 0 }],
    special_action: { type: 'claim_spark', special_id: spark.id },
  };
  const finalClaim = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: finalBody });
  assert.equal(finalClaim.response.status, 200);
  assert.deepEqual(finalClaim.json.special_discovered, { special_id: spark.id, kind: 'spark' });
  assert.equal(finalClaim.json.percent, 100);
  assert.ok(finalClaim.json.completed_at);
  assert.ok(finalClaim.json.artwork_id);

  const finalReplay = await request(`/colorings/${id}/progress/actions`, { method: 'POST', body: finalBody });
  assert.equal(finalReplay.response.status, 200);
  assert.equal(finalReplay.json.idempotent, true);
  assert.equal(finalReplay.json.special_discovered, null);
  assert.equal(finalReplay.json.percent, 100);
  assert.equal(finalReplay.json.completed_at, finalClaim.json.completed_at);
  assert.equal(finalReplay.json.artwork_id, finalClaim.json.artwork_id);
});
