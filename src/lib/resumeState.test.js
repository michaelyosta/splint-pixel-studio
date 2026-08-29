import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearResumeSnapshot,
  currentResumeStorageKey,
  isResumeCompatible,
  mergeResumeSnapshot,
  readCurrentResumeSnapshot,
  readResumeSnapshot,
  resumeStorageKey,
  writeResumeSnapshot,
} from './resumeState.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

const base = {
  artworkId: 'artwork-1',
  route: 'play',
  progressRevision: 7,
  camera: { x: 12, y: -4, zoom: 1.25 },
  selectedColor: 3,
  smartTarget: {
    kind: 'tiled',
    targetId: null,
    tileKey: '4:2',
    color: 3,
    estimatedCells: null,
    anchorX: 0,
    anchorY: 0,
    bounds: null,
    workCells: null,
    templateVersion: null,
  },
  smartTargetRevision: 7,
  nextBeat: {
    kind: 'fragment',
    tileKey: '4:2',
    targetId: null,
    color: 3,
    estimatedCells: 12,
  },
  sessionDurationBucket: 'medium',
  pendingSave: false,
  lastInteractionAt: '2026-08-15T00:00:00.000Z',
};

test('resume snapshot round-trips per artwork and current pointer', () => {
  const storage = createStorage();
  writeResumeSnapshot(base, { storage, scope: 'user-a' });
  assert.deepEqual(readResumeSnapshot('artwork-1', { storage, scope: 'user-a' }), {
    version: 1,
    ...base,
  });
  assert.equal(readCurrentResumeSnapshot({ storage, scope: 'user-a' }).artworkId, 'artwork-1');
  assert.equal(storage.getItem(currentResumeStorageKey('user-a'))?.includes('artwork-1'), true);
  assert.equal(storage.getItem(resumeStorageKey('user-a', 'artwork-1')) != null, true);
});

test('resume snapshot rejects unsafe values and never replaces server revision', () => {
  const storage = createStorage();
  const snapshot = mergeResumeSnapshot(base, {
    progressRevision: 8,
    camera: { x: 'bad', y: 0, zoom: 0 },
    smartTarget: { tileKey: '1:1', workCells: [1, '2', 'bad'] },
  });
  writeResumeSnapshot(snapshot, { storage, scope: 'user-a' });
  const restored = readResumeSnapshot('artwork-1', { storage, scope: 'user-a' });
  assert.equal(restored.progressRevision, 8);
  assert.equal(restored.camera, null);
  assert.deepEqual(restored.smartTarget.workCells, [1, 2]);
  assert.equal(isResumeCompatible(restored, { artworkId: 'artwork-1', revision: 8 }), true);
  assert.equal(isResumeCompatible(restored, { artworkId: 'artwork-1', revision: 7 }), false);
});

test('clearing artwork snapshot also clears current pointer', () => {
  const storage = createStorage();
  writeResumeSnapshot(base, { storage, scope: 'user-a' });
  clearResumeSnapshot('artwork-1', { storage, scope: 'user-a' });
  assert.equal(readResumeSnapshot('artwork-1', { storage, scope: 'user-a' }), null);
  assert.equal(readCurrentResumeSnapshot({ storage, scope: 'user-a' }), null);
});

test('per-artwork hints do not promote a merely viewed artwork to current resume', () => {
  const storage = createStorage();
  writeResumeSnapshot(base, { storage, scope: 'user-a' });
  writeResumeSnapshot({ ...base, artworkId: 'artwork-viewed', progressRevision: 0 }, {
    storage,
    scope: 'user-a',
    updateCurrent: false,
  });
  assert.equal(readResumeSnapshot('artwork-viewed', { storage, scope: 'user-a' }).artworkId, 'artwork-viewed');
  assert.equal(readCurrentResumeSnapshot({ storage, scope: 'user-a' }).artworkId, 'artwork-1');
  writeResumeSnapshot({ ...base, artworkId: 'artwork-1', progressRevision: 0 }, {
    storage,
    scope: 'user-a',
    updateCurrent: false,
  });
  assert.equal(readCurrentResumeSnapshot({ storage, scope: 'user-a' }), null);
});
