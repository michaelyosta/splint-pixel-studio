import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const serverCwd = basename(process.cwd()).toLowerCase() === 'server' ? process.cwd() : join(process.cwd(), 'server');
const portBase = 32600 + (process.pid % 300);
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
    const timer = setTimeout(() => reject(new Error(`Spark offer reload server did not start${stderr ? `: ${stderr}` : ''}`)), 60_000);
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
      reject(new Error(`Spark offer reload server exited before start (code=${code}, signal=${signal})${stderr ? `: ${stderr}` : ''}`));
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

async function startServer(t) {
  const directory = await mkdtemp(join(tmpdir(), 'splint-offer-reload-'));
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
      SPECIAL_CELLS_COHORT: 'SPARK_TREATMENT',
      SPECIAL_CELLS_QA_OVERRIDE: 'true',
      SPECIAL_CELLS_QA_USER_ID: 'user_legacy_offer_reload',
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

test('legacy reload restores the persisted Spark offer and the recovered token is usable once', async (t) => {
  const baseUrl = await startServer(t);
  const request = createClient(baseUrl, 'user_legacy_offer_reload');

  const created = await request('/colorings/create', {
    method: 'POST',
    body: {
      title: 'Legacy Spark offer reload',
      storageMode: 'legacy',
      width: 28,
      height: 28,
      palette: ['#101820', '#ffffff'],
      cells: legacyCells(28, 28),
    },
  });
  assert.equal(created.response.status, 201);
  const id = created.json.id;

  const initialProgress = await request(`/colorings/${id}/progress`);
  assert.equal(initialProgress.response.status, 200);
  assert.equal(initialProgress.json.specials_experiment_group, 'treatment');
  assert.equal(initialProgress.json.specials.length, 1);
  assert.equal(initialProgress.json.special_offer, null);
  const spark = initialProgress.json.specials[0];

  const claimed = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'legacy-offer-reload-claim-001',
      changes: [{ index: spark.cell_index, color: 0 }],
      special_action: { type: 'claim_spark', special_id: spark.id },
    },
  });
  assert.equal(claimed.response.status, 200);
  assert.ok(claimed.json.special_offer.offer_token);

  const reloaded = await request(`/colorings/${id}/progress`);
  assert.equal(reloaded.response.status, 200);
  assert.equal(reloaded.json.revision, claimed.json.revision);
  assert.ok(reloaded.json.special_offer, 'legacy reload restores the persisted offer');
  assert.equal(reloaded.json.special_offer.offer_token, claimed.json.special_offer.offer_token);
  assert.deepEqual(reloaded.json.special_offer.target_options, claimed.json.special_offer.target_options);
  assert.equal(reloaded.json.specials[0].state, 'offered');

  const secondReload = await request(`/colorings/${id}/progress`);
  assert.equal(secondReload.json.special_offer.offer_token, claimed.json.special_offer.offer_token,
    'legacy reload is read-only and does not rotate the token');

  const used = await request(`/colorings/${id}/progress/actions`, {
    method: 'POST',
    body: {
      revision: reloaded.json.revision,
      clientBatchId: 'legacy-offer-reload-use-001',
      changes: [],
      special_action: {
        type: 'use_spark',
        special_id: spark.id,
        offer_token: reloaded.json.special_offer.offer_token,
        option_id: reloaded.json.special_offer.target_options[0].option_id,
      },
    },
  });
  assert.equal(used.response.status, 200);
  assert.equal(
    used.json.special_applied_changes.length,
    reloaded.json.special_offer.target_options[0].estimated_cells,
  );
  assert.ok(used.json.special_applied_changes.length > 32);

  const afterUse = await request(`/colorings/${id}/progress`);
  assert.equal(afterUse.response.status, 200);
  assert.equal(afterUse.json.special_offer, null);
  assert.equal(afterUse.json.specials[0].state, 'consumed');
});
