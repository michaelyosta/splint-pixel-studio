import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const botToken = '1234567890:security-hardening-test-token';

async function getFreePort() {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function telegramInitData(user) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'security-test-query',
    user: JSON.stringify(user),
  });
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}

test('public-alpha security boundaries', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-security-'));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      SQLITE_DB_PATH: join(directory, 'security.db.bin'),
      MEDIA_STORAGE_ROOT: join(directory, 'uploads'),
      ALLOW_DEV_AUTH: 'true',
      SEED_DEMO_DATA: 'true',
      TELEGRAM_BOT_TOKEN: botToken,
      NODE_ENV: 'test',
      RATE_LIMIT_MAX: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    server.kill();
    await rm(directory, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Security test API did not start')), 10_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once('error', reject);
  });

  async function request(path, {
    userId = 'user_pixelhunter',
    telegramData,
    method = 'GET',
    body,
    headers = {},
  } = {}) {
    const authHeaders = telegramData
      ? { 'X-Telegram-Init-Data': telegramData }
      : userId ? { 'X-User-Id': userId } : {};
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeaders, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    return { response, json };
  }

  await t.test('report validation, uniqueness, concurrency and auto-hide', async () => {
    const missing = await request('/posts/missing/report', { method: 'POST', body: { reason: 'spam' } });
    assert.equal(missing.response.status, 404);
    assert.deepStrictEqual(missing.json, { error: 'Report target not found', code: 'TARGET_NOT_FOUND' });

    const invalidReason = await request('/posts/post_showcase_whale/report', {
      userId: 'user_lenaart', method: 'POST', body: { reason: 'not-an-enum-value' },
    });
    assert.equal(invalidReason.response.status, 400);
    assert.equal(invalidReason.json.code, 'INVALID_REPORT');

    const concurrent = await Promise.all([
      request('/posts/post_showcase_whale/report', { method: 'POST', body: { reason: 'spam' } }),
      request('/posts/post_showcase_whale/report', { method: 'POST', body: { reason: 'spam' } }),
    ]);
    assert.deepStrictEqual(concurrent.map(({ response }) => response.status).sort(), [200, 409]);
    assert.equal(concurrent.find(({ response }) => response.status === 409).json.code, 'DUPLICATE_REPORT');

    const first = await request('/posts/post_showcase_fox/report', {
      userId: 'user_pixelhunter', method: 'POST', body: { reason: 'spam' },
    });
    assert.equal(first.response.status, 200);
    assert.equal((await request('/posts/post_showcase_fox')).response.status, 200);

    const second = await request('/posts/post_showcase_fox/report', {
      userId: 'user_artvibe', method: 'POST', body: { reason: 'harassment' },
    });
    assert.equal(second.response.status, 200);
    assert.equal((await request('/posts/post_showcase_fox')).response.status, 200);

    const third = await request('/posts/post_showcase_fox/report', {
      userId: 'user_splintmod', method: 'POST', body: { reason: 'other' },
    });
    assert.equal(third.response.status, 200);
    assert.equal((await request('/posts/post_showcase_fox')).response.status, 404);

    const actions = await request('/moderation/actions', { userId: 'user_splintmod' });
    const autoHide = actions.json.filter((action) => action.action === 'auto_hide' && action.target_id === 'post_showcase_fox');
    assert.equal(autoHide.length, 1);
    assert.equal(autoHide[0].actor_user_id, null);
    assert.equal(autoHide[0].reason, 'unique_reports_threshold');
    assert.equal(autoHide[0].previous_state, 'active');
    assert.equal(autoHide[0].new_state, 'hidden');

    const reportHidden = await request('/posts/post_showcase_fox/report', {
      userId: 'limit_reporter', method: 'POST', body: { reason: 'spam' },
    });
    assert.equal(reportHidden.response.status, 404);
    const actionsAfter = await request('/moderation/actions', { userId: 'user_splintmod' });
    assert.equal(actionsAfter.json.filter((action) => action.action === 'auto_hide' && action.target_id === 'post_showcase_fox').length, 1);

    const deleted = await request('/posts/post_showcase_dragon', {
      userId: 'user_lenaart', method: 'DELETE',
    });
    assert.equal(deleted.response.status, 200);
    const reportDeleted = await request('/posts/post_showcase_dragon/report', {
      method: 'POST', body: { reason: 'spam' },
    });
    assert.equal(reportDeleted.response.status, 404);
  });

  await t.test('daily report limit is enforced per reporter', async () => {
    for (let index = 0; index < 21; index += 1) {
      await request('/users/me', { userId: `report_target_${index}` });
    }
    for (let index = 0; index < 20; index += 1) {
      const result = await request('/moderation/reports/create', {
        userId: 'limit_reporter',
        method: 'POST',
        body: { targetType: 'user', targetId: `report_target_${index}`, reason: 'spam' },
      });
      assert.equal(result.response.status, 200, `report ${index + 1} should be accepted`);
    }
    const limited = await request('/moderation/reports/create', {
      userId: 'limit_reporter',
      method: 'POST',
      body: { targetType: 'user', targetId: 'report_target_20', reason: 'spam' },
    });
    assert.equal(limited.response.status, 429);
    assert.equal(limited.json.code, 'REPORT_LIMIT');
  });

  await t.test('comment route contract cannot cross into post or report handlers', async () => {
    const comment = await request('/posts/post_showcase_whale/comments', {
      userId: 'user_lenaart', method: 'POST', body: { text: 'Route contract comment' },
    });
    assert.equal(comment.response.status, 201);

    const oldReportPath = await request(`/posts/${comment.json.id}/report`, {
      userId: 'user_splintmod', method: 'POST', body: { reason: 'spam' },
    });
    assert.equal(oldReportPath.response.status, 404);
    assert.equal(oldReportPath.json.code, 'TARGET_NOT_FOUND');

    const oldDeletePath = await request(`/posts/${comment.json.id}`, {
      userId: 'user_lenaart', method: 'DELETE',
    });
    assert.equal(oldDeletePath.response.status, 404);
    assert.equal(oldDeletePath.json.error, 'Пост не найден');

    const reported = await request(`/comments/${comment.json.id}/report`, {
      userId: 'user_splintmod', method: 'POST', body: { reason: 'spam' },
    });
    assert.equal(reported.response.status, 200);
    const afterReport = await request('/posts/post_showcase_whale/comments');
    assert.ok(afterReport.json.some(({ id }) => id === comment.json.id), 'report must not delete the comment');

    const removed = await request(`/comments/${comment.json.id}`, {
      userId: 'user_lenaart', method: 'DELETE',
    });
    assert.equal(removed.response.status, 200);
    assert.deepStrictEqual(removed.json, { success: true });
    const afterDelete = await request('/posts/post_showcase_whale/comments');
    assert.equal(afterDelete.json.some(({ id }) => id === comment.json.id), false);
    assert.equal((await request(`/comments/${comment.json.id}/report`, {
      userId: 'user_splintmod', method: 'POST', body: { reason: 'spam' },
    })).response.status, 404);

    const hiddenComment = await request('/posts/post_showcase_whale/comments', {
      userId: 'user_artvibe', method: 'POST', body: { text: 'Hidden route contract comment' },
    });
    assert.equal(hiddenComment.response.status, 201);
    assert.equal((await request('/moderation/hide', {
      userId: 'user_splintmod',
      method: 'POST',
      body: { targetType: 'comment', targetId: hiddenComment.json.id, reason: 'hide comment test' },
    })).response.status, 200);
    assert.equal((await request(`/comments/${hiddenComment.json.id}/report`, {
      userId: 'user_pixelhunter', method: 'POST', body: { reason: 'spam' },
    })).response.status, 404);
  });

  await t.test('public DTOs and hidden content stay closed across every read path', async () => {
    const publicProfile = await request('/users/user_lenaart/profile');
    for (const field of [
      'email', 'telegram_id', 'role', 'is_banned', 'ban_reason', 'banned_at',
      'stars_balance', 'messages_disabled', 'followers_only', 'paid_open', 'price_in_stars',
      'original_media_key',
    ]) {
      assert.equal(Object.hasOwn(publicProfile.json, field), false, `public profile leaked ${field}`);
    }
    assert.equal(publicProfile.json.posts_count, 0);

    const ownProfile = await request('/users/me');
    for (const field of ['email', 'telegram_id', 'role', 'is_banned', 'ban_reason', 'banned_at']) {
      assert.equal(Object.hasOwn(ownProfile.json, field), false, `own profile leaked ${field}`);
    }

    const feed = await request('/feed/recommended');
    assert.equal(feed.json.some(({ id }) => id === 'post_showcase_fox' || id === 'post_showcase_dragon'), false);

    const posts = await request('/users/user_lenaart/posts');
    assert.equal(posts.json.some(({ id }) => id === 'post_showcase_fox' || id === 'post_showcase_dragon'), false);

    assert.equal((await request('/posts/post_showcase_fox')).response.status, 404);
    assert.equal((await request('/posts/post_showcase_fox/comments')).response.status, 404);

    const artworks = await request('/users/user_lenaart/artworks');
    assert.equal(artworks.json.some(({ id }) => id === 'art_showcase_fox' || id === 'art_showcase_dragon'), false);
    for (const artwork of artworks.json) {
      assert.equal(Object.hasOwn(artwork, 'original_media_key'), false);
    }

    const collectionTemplates = await request('/meta/collections/col_cozy-forest/templates');
    for (const template of collectionTemplates.json) {
      assert.equal(Object.hasOwn(template, 'original_media_key'), false);
      assert.equal(Object.hasOwn(template, 'palette_json'), false);
      assert.equal(Object.hasOwn(template, 'cells_json'), false);
    }

    const moderatorReports = await request('/moderation/reports', { userId: 'user_splintmod' });
    assert.ok(moderatorReports.json.some(({ target_id }) => target_id === 'post_showcase_fox'));
  });

  await t.test('moderation list and audit log enforce authorization and actor integrity', async () => {
    assert.equal((await request('/users', { userId: null })).response.status, 401);
    assert.equal((await request('/users')).response.status, 403);
    assert.equal((await request('/moderation/actions')).response.status, 403);

    const before = await request('/moderation/actions', { userId: 'user_splintmod' });
    const missing = await request('/moderation/hide', {
      userId: 'user_splintmod',
      method: 'POST',
      body: { targetType: 'post', targetId: 'does_not_exist', reason: 'test', actorUserId: 'spoofed' },
    });
    assert.equal(missing.response.status, 404);
    const afterMissing = await request('/moderation/actions', { userId: 'user_splintmod' });
    assert.equal(afterMissing.json.length, before.json.length);

    const manual = await request('/moderation/hide', {
      userId: 'user_splintmod',
      method: 'POST',
      body: { targetType: 'post', targetId: 'post_showcase_whale', reason: 'manual test', actorUserId: 'spoofed' },
    });
    assert.equal(manual.response.status, 200);
    const afterManual = await request('/moderation/actions', { userId: 'user_splintmod' });
    const action = afterManual.json.find((entry) => entry.action === 'hide' && entry.target_id === 'post_showcase_whale');
    assert.equal(action.actor_user_id, 'user_splintmod');
    assert.equal(action.reason, 'manual test');
    assert.equal(action.previous_state, 'active');
    assert.equal(action.new_state, 'hidden');
  });

  await t.test('central ban policy covers the authenticated route matrix', async () => {
    await request('/users/me', { userId: 'matrix_banned' });
    const ban = await request('/moderation/ban', {
      userId: 'user_splintmod', method: 'POST', body: { userId: 'matrix_banned', reason: 'matrix' },
    });
    assert.equal(ban.response.status, 200);

    const matrix = [
      ['POST', '/posts/create', {}],
      ['GET', '/posts/any', undefined],
      ['GET', '/posts/by-user/any', undefined],
      ['DELETE', '/posts/any', undefined],
      ['POST', '/posts/any/toggle-comments', {}],
      ['GET', '/posts/any/comments', undefined],
      ['POST', '/posts/any/comments', { text: 'x' }],
      ['DELETE', '/comments/any', undefined],
      ['POST', '/comments/any/report', { reason: 'spam' }],
      ['POST', '/posts/any/report', { reason: 'spam' }],
      ['POST', '/posts/any/like', undefined],
      ['DELETE', '/posts/any/like', undefined],
      ['POST', '/users/any/follow', undefined],
      ['GET', '/users/any/followers', undefined],
      ['GET', '/users/any/following', undefined],
      ['POST', '/messages/request/create', {}],
      ['POST', '/messages/request/pay', {}],
      ['POST', '/messages/request/reply', {}],
      ['POST', '/messages/request/reject', {}],
      ['GET', '/messages/requests/inbox', undefined],
      ['GET', '/messages/requests/outbox', undefined],
      ['POST', '/colorings/create', {}],
      ['GET', '/colorings/today', undefined],
      ['GET', '/colorings/mine', undefined],
      ['GET', '/colorings/any', undefined],
      ['GET', '/colorings/any/zones', undefined],
      ['GET', '/colorings/any/progress', undefined],
      ['PUT', '/colorings/any/progress', {}],
      ['DELETE', '/colorings/any', undefined],
      ['GET', '/users/any/profile', undefined],
      ['GET', '/users/any/posts', undefined],
      ['GET', '/users/any/artworks', undefined],
      ['PATCH', '/users/matrix_banned/settings', { status: 'x' }],
      ['GET', '/users/collections/all', undefined],
      ['POST', '/users/collections/any/add', undefined],
      ['POST', '/users/artworks/any/complete', undefined],
      ['GET', '/meta/streak', undefined],
      ['POST', '/meta/streak/touch', undefined],
      ['GET', '/meta/achievements', undefined],
      ['POST', '/meta/achievements/any/unlock', undefined],
      ['GET', '/meta/collections', undefined],
      ['GET', '/meta/collections/any/templates', undefined],
      ['POST', '/meta/analytics', {}],
      ['GET', '/meta/analytics/summary', undefined],
      ['POST', '/moderation/reports/create', {}],
      ['GET', '/moderation/reports', undefined],
      ['GET', '/moderation/actions', undefined],
      ['POST', '/moderation/hide', { targetType: 'post', targetId: 'any' }],
      ['POST', '/moderation/approve', { targetType: 'post', targetId: 'any' }],
      ['POST', '/moderation/ban', { userId: 'any' }],
      ['POST', '/moderation/unban', { userId: 'any' }],
      ['GET', '/moderation/banned-users', undefined],
      ['GET', '/feed/recommended', undefined],
      ['GET', '/feed/following', undefined],
      ['GET', '/users/me', undefined],
      ['GET', '/users', undefined],
      ['GET', '/colorings', undefined],
    ];

    for (const [method, path, body] of matrix) {
      const result = await request(path, { userId: 'matrix_banned', method, body });
      assert.equal(result.response.status, 403, `${method} ${path}`);
      assert.equal(result.json.code, 'ACCOUNT_BANNED', `${method} ${path}`);
    }

    assert.equal((await request('/users', { userId: 'matrix_banned' })).response.status, 403);
    assert.equal((await request('/moderation/actions', { userId: 'matrix_banned' })).response.status, 403);

    await request('/users/me', { userId: 'banned_admin' });
    await request('/meta/_test/set-role', {
      userId: 'user_splintmod', method: 'PATCH', body: { userId: 'banned_admin', role: 'admin' },
    });
    await request('/moderation/ban', {
      userId: 'user_splintmod', method: 'POST', body: { userId: 'banned_admin' },
    });
    const bannedAdmin = await request('/moderation/actions', { userId: 'banned_admin' });
    assert.equal(bannedAdmin.response.status, 403, 'admin role does not bypass a full account ban');
  });

  await t.test('Telegram re-authorization rechecks the ban', async () => {
    const initData = telegramInitData({ id: 99112233, first_name: 'Banned Telegram user' });
    const first = await request('/users/me', { userId: null, telegramData: initData });
    assert.equal(first.response.status, 200);
    await request('/moderation/ban', {
      userId: 'user_splintmod', method: 'POST', body: { userId: 'tg_99112233', reason: 'telegram reauth test' },
    });
    const second = await request('/users/me', { userId: null, telegramData: initData });
    assert.equal(second.response.status, 403);
    assert.equal(second.json.code, 'ACCOUNT_BANNED');
  });
});
