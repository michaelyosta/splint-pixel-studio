import test from 'node:test';
import assert from 'node:assert/strict';
import { API_BASE, resolveApiBase, resolveApiUrl } from '../src/api/apiBase.js';
import { createProgressiveGridClient } from '../src/lib/progressiveGridClient.js';

function manifestResponse(templateId) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      schema_version: 1,
      template_id: templateId,
      template: { id: templateId, width: 8, height: 8, palette: ['#000000', '#ffffff'] },
      grid: { width: 8, height: 8, tile_size: 32 },
      links: {},
    }),
  };
}

test('configured API origin is shared by ordinary and progressive-grid URLs', async () => {
  const base = resolveApiBase({ VITE_API_URL: 'https://api.example.test/' });
  const expected = 'https://api.example.test/colorings/custom-tiled/manifest';
  const calls = [];
  const client = createProgressiveGridClient({
    templateId: 'custom-tiled',
    baseUrl: base,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return manifestResponse('custom-tiled');
    },
  });

  await client.loadManifest();
  assert.equal(resolveApiUrl('/colorings/custom-tiled/manifest', base), expected);
  assert.equal(calls[0], expected);
  client.destroy();
});

test('missing VITE_API_URL preserves the local /api contract', async () => {
  assert.equal(resolveApiBase({}), '/api');
  const calls = [];
  const client = createProgressiveGridClient({
    templateId: 'local-tiled',
    fetchImpl: async (url) => {
      calls.push(String(url));
      return manifestResponse('local-tiled');
    },
  });

  await client.loadManifest();
  assert.equal(API_BASE, '/api');
  assert.equal(calls[0], '/api/colorings/local-tiled/manifest');
  client.destroy();
});
