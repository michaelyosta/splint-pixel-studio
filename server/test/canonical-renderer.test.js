import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCanonicalPng, renderCanonicalThumbnail } from '../services/canonical-renderer.js';

test('canonical renderer is deterministic and returns encoded metadata', () => {
  const input = { width: 2, height: 2, palette: ['#ff0000', '#00ff00'], cells: [0, 1, 1, 0], filled: [0, 1, 1, 0] };
  const first = renderCanonicalPng(input);
  const second = renderCanonicalPng(input);
  assert.deepEqual(first, second);
  assert.equal(first.mimeType, 'image/png');
  assert.equal(first.width, 2);
  assert.equal(first.height, 2);
  assert.equal(first.byteSize, first.buffer.length);
  assert.equal(first.buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(first.contentHash.length, 64);
});

test('canonical renderer ignores a mismatched client image by deriving only from server fields', () => {
  const a = renderCanonicalPng({ width: 1, height: 1, palette: ['#123456'], cells: [0], filled: [0] });
  const b = renderCanonicalPng({ width: 1, height: 1, palette: ['#123456'], cells: [0], filled: [0] });
  assert.equal(a.contentHash, b.contentHash);
});

test('canonical thumbnail is deterministic and bounded independently of the full artifact', () => {
  const thumbnail = renderCanonicalThumbnail({
    width: 160,
    height: 120,
    palette: ['#112233', '#aabbcc'],
    cells: Array(160 * 120).fill(0),
    filled: Array(160 * 120).fill(0),
  });
  assert.ok(thumbnail.width <= 48);
  assert.ok(thumbnail.height <= 48);
  assert.equal(thumbnail.mimeType, 'image/png');
  assert.equal(thumbnail.contentHash, renderCanonicalThumbnail({
    width: 160,
    height: 120,
    palette: ['#112233', '#aabbcc'],
    cells: Array(160 * 120).fill(0),
    filled: Array(160 * 120).fill(0),
  }).contentHash);
});
