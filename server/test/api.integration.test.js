import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..');

const port = 31901;
const baseUrl = `http://127.0.0.1:${port}`;
const validPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function request(path, { userId = 'user_pixelhunter', method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  return { response, json };
}

test('coloring progress can become a social post', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-api-'));
  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(port), SQLITE_DB_PATH: join(directory, 'test.db.bin'), MEDIA_STORAGE_ROOT: join(directory, 'uploads'), ALLOW_DEV_AUTH: 'true', SEED_DEMO_DATA: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    server.kill();
    await rm(directory, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API did not start')), 8_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once('error', reject);
  });

  const catalog = await request('/colorings');
  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.json.length, 6);
  assert.ok(catalog.json.every((item) => item.preview_url.includes('/assets/catalog/')));

  const me = await request('/users/me');
  assert.equal(me.response.status, 200);
  assert.equal(me.json.id, 'user_pixelhunter');
  assert.ok(Object.hasOwn(me.json, 'stars_balance'));

  const unlockAttempt = await request('/meta/achievements/ach_first_zone/unlock', { method: 'POST' });
  assert.equal(unlockAttempt.response.status, 403);
  assert.equal(unlockAttempt.json.code, 'ACHIEVEMENT_UNLOCK_FORBIDDEN');
  const achievements = await request('/meta/achievements');
  assert.equal(achievements.json.find((achievement) => achievement.id === 'ach_first_zone').unlocked, false);
  const initialStreak = await request('/meta/streak');
  const streakAttempt = await request('/meta/streak/touch', { method: 'POST' });
  assert.equal(streakAttempt.response.status, 403);
  assert.equal(streakAttempt.json.code, 'STREAK_TOUCH_FORBIDDEN');
  const unchangedStreak = await request('/meta/streak');
  assert.deepEqual(unchangedStreak.json, initialStreak.json);
  const invalidAnalytics = await request('/meta/analytics', { method: 'POST', body: { event: 'arbitrary_event', payload: {} } });
  assert.equal(invalidAnalytics.response.status, 400);
  const validAnalytics = await request('/meta/analytics', { method: 'POST', body: { event: 'open_level', payload: { id: 'catalog_fox' } } });
  assert.equal(validAnalytics.response.status, 200);
  const smartEngineAnalytics = await request('/meta/analytics', { method: 'POST', body: { event: 'camera_activate_target', payload: { templateId: 'catalog_fox' } } });
  assert.equal(smartEngineAnalytics.response.status, 200);

  const publicProfile = await request('/users/user_lenaart/profile');
  assert.equal(publicProfile.response.status, 200);
  for (const sensitiveField of ['telegram_id', 'stars_balance', 'role', 'is_banned', 'messages_disabled', 'followers_only', 'paid_open', 'price_in_stars']) {
    assert.equal(Object.hasOwn(publicProfile.json, sensitiveField), false);
  }

  const custom = await request('/colorings/create', {
    method: 'POST',
    body: { title: 'Private import', width: 8, height: 8, palette: ['#102030', '#00b5d8'], cells: Array.from({ length: 64 }, (_, index) => index % 2), previewDataUrl: validPng, originalDataUrl: validPng },
  });
  assert.equal(custom.response.status, 201);
  assert.equal(custom.json.visibility, 'private');
  assert.equal(custom.json.source_stored, true);

  const template = await request(`/colorings/${catalog.json[0].id}`);
  assert.equal(template.response.status, 200);
  const progress = await request(`/colorings/${catalog.json[0].id}/progress`);
  assert.equal(progress.json.percent, 0);

  const forgedMap = await request(`/colorings/${catalog.json[0].id}/progress`, {
    method: 'PUT',
    body: { filled: template.json.cells, revision: progress.json.revision },
  });
  assert.equal(forgedMap.response.status, 405, 'whole client map must not be accepted');

  const forgedColor = await request(`/colorings/${catalog.json[0].id}/progress/actions`, {
    method: 'POST',
    body: { changes: [{ index: 0, color: (template.json.cells[0] + 1) % template.json.palette.length }], revision: progress.json.revision },
  });
  assert.equal(forgedColor.response.status, 400, 'server must derive the valid color for every cell');

  let completed;
  let revision = progress.json.revision;
  for (let offset = 0; offset < template.json.cells.length; offset += 64) {
    completed = await request(`/colorings/${catalog.json[0].id}/progress/actions`, {
      method: 'POST',
      body: {
        changes: template.json.cells.slice(offset, offset + 64).map((color, index) => ({ index: index + offset, color })),
        revision,
        resultDataUrl: offset + 64 >= template.json.cells.length ? validPng : null,
      },
    });
    revision = completed.json.revision;
  }
  assert.equal(completed.response.status, 200);
  assert.equal(completed.json.percent, 100);
  assert.ok(completed.json.artwork_id);

  const post = await request('/posts/create', {
    method: 'POST',
    body: { artworkId: completed.json.artwork_id, title: 'Test completion', caption: 'Painted in an integration test', commentsEnabled: true },
  });
  assert.equal(post.response.status, 201);
  assert.equal(post.json.artwork.image_url, validPng);

  const comment = await request(`/posts/${post.json.id}/comments`, {
    userId: 'user_lenaart',
    method: 'POST',
    body: { text: 'Looks great!' },
  });
  assert.equal(comment.response.status, 201);

  const liked = await request(`/posts/${post.json.id}/like`, { userId: 'user_lenaart', method: 'POST' });
  assert.equal(liked.json.is_liked, true);

  const feed = await request('/feed/recommended', { userId: 'user_lenaart' });
  const feedPost = feed.json.find((item) => item.id === post.json.id);
  assert.ok(feedPost);
  assert.equal(feedPost.comment_count, 1);
  assert.equal(feedPost.is_liked, true);

  const report = await request(`/posts/${post.json.id}/report`, { userId: 'user_lenaart', method: 'POST', body: { reason: 'other' } });
  assert.equal(report.response.status, 200);
  const duplicateReport = await request(`/posts/${post.json.id}/report`, { userId: 'user_lenaart', method: 'POST', body: { reason: 'spam' } });
  assert.equal(duplicateReport.response.status, 409);

  const deletedComment = await request(`/comments/${comment.json.id}`, { userId: 'user_lenaart', method: 'DELETE' });
  assert.equal(deletedComment.response.status, 200);

  const reportableComment = await request(`/posts/${post.json.id}/comments`, {
    userId: 'user_artvibe',
    method: 'POST',
    body: { text: 'A second integration comment' },
  });
  assert.equal(reportableComment.response.status, 201);
  const commentReport = await request(`/comments/${reportableComment.json.id}/report`, {
    userId: 'user_lenaart',
    method: 'POST',
    body: { reason: 'spam' },
  });
  assert.equal(commentReport.response.status, 200);
  const duplicateCommentReport = await request(`/comments/${reportableComment.json.id}/report`, {
    userId: 'user_lenaart',
    method: 'POST',
    body: { reason: 'other' },
  });
  assert.equal(duplicateCommentReport.response.status, 409);

  await request(`/posts/${post.json.id}/report`, { userId: 'user_artvibe', method: 'POST', body: { reason: 'spam' } });
  await request(`/posts/${post.json.id}/report`, { userId: 'user_splintmod', method: 'POST', body: { reason: 'spam' } });
  const hiddenPost = await request(`/posts/${post.json.id}`);
  assert.equal(hiddenPost.response.status, 404);
  const hiddenComments = await request(`/posts/${post.json.id}/comments`);
  assert.equal(hiddenComments.response.status, 404);
  const publicArtworks = await request('/users/user_pixelhunter/artworks', { userId: 'user_lenaart' });
  assert.equal(publicArtworks.json.some((artwork) => artwork.id === completed.json.artwork_id), false);

  const ban = await request('/moderation/ban', {
    userId: 'user_splintmod',
    method: 'POST',
    body: { userId: 'user_artvibe' },
  });
  assert.equal(ban.response.status, 200);
  const bannedAction = await request('/meta/streak', { userId: 'user_artvibe' });
  assert.equal(bannedAction.response.status, 403);
  assert.equal(bannedAction.json.code, 'ACCOUNT_BANNED');

  const deleted = await request(`/colorings/${custom.json.id}`, { method: 'DELETE' });
  assert.equal(deleted.response.status, 200);
  const deletedTemplate = await request(`/colorings/${custom.json.id}`);
  assert.equal(deletedTemplate.response.status, 404);
});
