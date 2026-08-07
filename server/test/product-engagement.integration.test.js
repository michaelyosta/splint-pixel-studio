import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..');
const port = 31917;
const baseUrl = `http://127.0.0.1:${port}`;

async function request(path, { userId = 'user_pixelhunter', method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, json: await response.json().catch(() => ({})) };
}

test('product engagement APIs use verified actions and keep creator packs free', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-engagement-'));
  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      SQLITE_DB_PATH: join(directory, 'test.db.bin'),
      MEDIA_STORAGE_ROOT: join(directory, 'uploads'),
      ALLOW_DEV_AUTH: 'true',
      SEED_DEMO_DATA: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    server.kill();
    await rm(directory, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API did not start')), 10_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once('error', reject);
  });

  const catalog = await request('/colorings?access=free&sort=new&limit=3');
  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.json.length, 3);
  assert.ok(catalog.json.every((item) => item.access === 'free'));
  assert.ok(catalog.json.every((item) => typeof item.is_favorite === 'boolean'));
  const search = await request(`/colorings?q=${encodeURIComponent(catalog.json[0].title.toLocaleLowerCase())}`);
  assert.equal(search.response.status, 200);
  assert.ok(search.json.some((item) => item.id === catalog.json[0].id), 'search is case-insensitive for Cyrillic catalog titles');

  const unsafeSort = await request('/colorings?sort=title;DROP%20TABLE%20users');
  assert.equal(unsafeSort.response.status, 400);
  assert.equal(unsafeSort.json.code, 'INVALID_CATALOG_SORT');

  const templateId = catalog.json[0].id;
  const favorite = await request(`/colorings/${templateId}/favorite`, { method: 'PUT' });
  assert.equal(favorite.response.status, 200);
  assert.equal(favorite.json.is_favorite, true);
  const favorites = await request('/colorings/favorites');
  assert.equal(favorites.response.status, 200);
  assert.equal(favorites.json[0].id, templateId);
  assert.equal(favorites.json[0].is_favorite, true);

  const opened = await request(`/colorings/${templateId}`);
  assert.equal(opened.response.status, 200);
  const history = await request('/colorings/history?limit=1');
  assert.equal(history.response.status, 200);
  assert.equal(history.json[0].id, templateId);

  const daily = await request('/meta/daily-challenge');
  assert.equal(daily.response.status, 200);
  const dailyTemplate = await request(`/colorings/${daily.json.template_id}`);
  const dailyProgress = await request(`/colorings/${daily.json.template_id}/progress`);
  const count = daily.json.target_cells;
  const actionBody = {
    revision: dailyProgress.json.revision,
    changes: dailyTemplate.json.cells.slice(0, count).map((color, index) => ({ index, color })),
  };
  const action = await request(`/colorings/${daily.json.template_id}/progress/actions`, { method: 'POST', body: actionBody });
  assert.equal(action.response.status, 200);
  assert.equal(action.json.rewards.daily_challenge.completed, true);
  assert.equal(action.json.rewards.daily_challenge.xp_awarded, 30);
  assert.equal(action.json.rewards.xp_awarded, count + 30);
  assert.equal(action.json.rewards.progression.xp_total, count + 30);

  const replay = await request(`/colorings/${daily.json.template_id}/progress/actions`, { method: 'POST', body: actionBody });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.json.idempotent, true);
  const undo = await request(`/colorings/${daily.json.template_id}/progress/actions`, {
    method: 'POST',
    body: { revision: action.json.revision, changes: [{ index: 0, color: -1 }] },
  });
  assert.equal(undo.response.status, 200);
  const repaint = await request(`/colorings/${daily.json.template_id}/progress/actions`, {
    method: 'POST',
    body: { revision: undo.json.revision, changes: [{ index: 0, color: dailyTemplate.json.cells[0] }] },
  });
  assert.equal(repaint.response.status, 200);
  assert.equal(repaint.json.rewards.xp_awarded, 0, 'undoing and repainting a cell cannot farm XP');
  const progression = await request('/meta/progression');
  assert.equal(progression.response.status, 200);
  assert.equal(progression.json.xp_total, count + 30, 'replays and repainting cannot award XP again');
  assert.equal(progression.json.level, 1);

  const weeklyBefore = await request('/meta/weekly-challenge', { userId: 'weekly_test_user' });
  assert.equal(weeklyBefore.response.status, 200);
  assert.equal(weeklyBefore.json.progress_cells, 0);
  assert.equal(weeklyBefore.json.target_cells, 100);
  const weeklyTemplate = await request('/colorings/create', {
    userId: 'weekly_test_user',
    method: 'POST',
    body: {
      title: 'Weekly goal fixture',
      width: 8,
      height: 16,
      palette: ['#102030', '#00b5d8'],
      cells: Array(128).fill(0),
    },
  });
  assert.equal(weeklyTemplate.response.status, 201);
  const weeklyId = weeklyTemplate.json.id;
  const weeklyFirst = await request(`/colorings/${weeklyId}/progress/actions`, {
    userId: 'weekly_test_user',
    method: 'POST',
    body: {
      revision: 0,
      clientBatchId: 'weekly-fixture-001',
      changes: Array.from({ length: 64 }, (_, index) => ({ index, color: 0 })),
    },
  });
  assert.equal(weeklyFirst.response.status, 200);
  assert.equal(weeklyFirst.json.rewards.weekly_challenge.progress_cells, 64);
  const weeklySecond = await request(`/colorings/${weeklyId}/progress/actions`, {
    userId: 'weekly_test_user',
    method: 'POST',
    body: {
      revision: weeklyFirst.json.revision,
      clientBatchId: 'weekly-fixture-002',
      changes: Array.from({ length: 36 }, (_, offset) => ({ index: offset + 64, color: 0 })),
    },
  });
  assert.equal(weeklySecond.response.status, 200);
  assert.equal(weeklySecond.json.rewards.weekly_challenge.completed, true);
  assert.equal(weeklySecond.json.rewards.weekly_challenge.xp_awarded, 100);
  const weeklyFinal = await request('/meta/weekly-challenge', { userId: 'weekly_test_user' });
  assert.equal(weeklyFinal.json.completed, true);
  assert.equal(weeklyFinal.json.progress_cells, 100);

  const imported = await request('/colorings/create', {
    method: 'POST',
    body: {
      title: 'Collection-ready import',
      width: 8,
      height: 8,
      palette: ['#102030', '#00b5d8'],
      cells: Array(64).fill(0),
    },
  });
  assert.equal(imported.response.status, 201);
  const publishedTemplate = await request(`/colorings/${imported.json.id}/visibility`, {
    method: 'PATCH',
    body: { visibility: 'public' },
  });
  assert.equal(publishedTemplate.response.status, 200);

  const draft = await request('/collections', {
    method: 'POST',
    body: { title: 'My first pack', price_in_stars: 999, pack_type: 'premium' },
  });
  assert.equal(draft.response.status, 201);
  assert.equal(draft.json.status, 'draft');
  assert.equal(draft.json.pack_type, 'free');
  assert.equal(draft.json.price_in_stars, 0);
  assert.equal(draft.json.purchasing_available, false);
  const hiddenDraft = await request(`/collections/${draft.json.id}`, { userId: 'user_lenaart' });
  assert.equal(hiddenDraft.response.status, 404, 'other users cannot inspect a draft');

  const item = await request(`/collections/${draft.json.id}/templates`, {
    method: 'POST',
    body: { template_id: imported.json.id },
  });
  assert.equal(item.response.status, 201);
  const blockedPublication = await request(`/collections/${draft.json.id}`, { method: 'PATCH', body: { status: 'published' } });
  assert.equal(blockedPublication.response.status, 422);
  const publishedCollection = await request(`/collections/${draft.json.id}`, {
    method: 'PATCH',
    body: { status: 'published', visibility: 'public' },
  });
  assert.equal(publishedCollection.response.status, 200);
  assert.equal(publishedCollection.json.status, 'published');
  const publicCollection = await request(`/collections/${draft.json.id}`, { userId: 'user_lenaart' });
  assert.equal(publicCollection.response.status, 200);
  assert.equal(publicCollection.json.templates.length, 1);
});
