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
    env: { ...process.env, PORT: String(port), SQLITE_DB_PATH: join(directory, 'test.db.bin'), MEDIA_STORAGE_ROOT: join(directory, 'uploads'), ALLOW_DEV_AUTH: 'true' },
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

  const completed = await request(`/colorings/${catalog.json[0].id}/progress`, {
    method: 'PUT',
    body: { filled: template.json.cells, revision: progress.json.revision, resultDataUrl: validPng },
  });
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

  const report = await request(`/posts/${post.json.id}/report`, { method: 'POST', body: { reason: 'other' } });
  assert.equal(report.response.status, 200);

  const deleted = await request(`/colorings/${custom.json.id}`, { method: 'DELETE' });
  assert.equal(deleted.response.status, 200);
  const deletedTemplate = await request(`/colorings/${custom.json.id}`);
  assert.equal(deletedTemplate.response.status, 404);
});
