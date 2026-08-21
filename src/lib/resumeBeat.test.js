import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySessionDuration,
  describeResumeBeat,
  normalizeResumeBeat,
  SESSION_DURATION_BUCKET,
} from './resumeBeat.js';

test('resume promise uses calm short, medium, and long session buckets', () => {
  assert.equal(classifySessionDuration(30_000), SESSION_DURATION_BUCKET.SHORT);
  assert.equal(classifySessionDuration(90_000), SESSION_DURATION_BUCKET.MEDIUM);
  assert.equal(classifySessionDuration(3 * 60_000), SESSION_DURATION_BUCKET.MEDIUM);
  assert.equal(classifySessionDuration(15 * 60_000), SESSION_DURATION_BUCKET.LONG);
});

test('resume beat is bounded and describes the next visual work', () => {
  const beat = normalizeResumeBeat({ kind: 'fragment', tileKey: '2:3', color: 4, estimatedCells: 11 });
  assert.deepEqual(beat, {
    kind: 'fragment',
    tileKey: '2:3',
    targetId: null,
    color: 4,
    estimatedCells: 11,
  });
  assert.deepEqual(describeResumeBeat({ nextBeat: beat }), {
    kind: 'fragment',
    title: 'Следующий фрагмент ждёт',
    detail: 'цвет №5 · около 11 клеток',
    promise: 'Откроем следующий фрагмент',
    tileKey: '2:3',
    targetId: null,
  });
});

test('missing beat stays honest instead of inventing a target', () => {
  assert.deepEqual(describeResumeBeat({}), {
    kind: 'saved-point',
    title: 'Следующий фрагмент ждёт',
    detail: 'Продолжим с сохранённой точки',
    promise: 'Сохранённая точка готова',
  });
});
