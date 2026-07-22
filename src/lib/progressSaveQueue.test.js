import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveQueue } from './progressSaveQueue.js';

function nop() {}

async function tick(ms = 10) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function barrier() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, release: () => resolve() };
}

test('Basic save calls putProgress with correct data', async () => {
  const calls = [];
  let capturedProgress = null;
  const savingStates = [];

  const queue = createSaveQueue({
    putProgress: async (p) => { calls.push(p); return { revision: 1 }; },
    getResultDataUrl: () => 'data:test',
    onProgress: (p) => { capturedProgress = p; },
    onNotice: nop,
    onSaving: (s) => savingStates.push(s),
  });

  queue.reset(0);
  queue.queueSave([0, 1, 2]);
  await tick(500);

  assert.equal(calls.length, 1, 'One API call made');
  assert.deepEqual(calls[0], { filled: [0, 1, 2], revision: 0, resultDataUrl: 'data:test' });
  assert.ok(capturedProgress, 'onProgress called');
  assert.deepEqual(savingStates, [true, false], 'saving went true then false');
  queue.dispose();
});

test('Change during in-flight save is sent after first completes', async () => {
  const calls = [];
  const { promise: firstDone, release: resolveFirst } = barrier();

  const queue = createSaveQueue({
    putProgress: async (p) => {
      calls.push(p);
      if (calls.length === 1) await firstDone;
      return { revision: calls.length };
    },
    getResultDataUrl: () => null,
    onProgress: nop,
    onNotice: nop,
    onSaving: nop,
  });

  queue.reset(0);
  queue.queueSave([1]);
  await tick(500);
  assert.equal(calls.length, 1, 'First save in flight');

  queue.queueSave([2]);
  await tick(100);
  assert.equal(calls.length, 1, 'Second save not yet sent (first in flight)');

  resolveFirst();
  await tick(600);
  assert.equal(calls.length, 2, 'Second save sent after first completed');
  queue.dispose();
});

test('Last pending snapshot is not lost', async () => {
  const calls = [];
  const { promise: firstDone, release: resolveFirst } = barrier();

  const queue = createSaveQueue({
    putProgress: async (p) => {
      calls.push(p);
      if (calls.length === 1) await firstDone;
      return { revision: calls.length };
    },
    getResultDataUrl: () => 'data:latest',
    onProgress: nop,
    onNotice: nop,
    onSaving: nop,
  });

  queue.reset(0);
  queue.queueSave([1]);
  await tick(500);
  assert.equal(calls.length, 1, 'First save started');

  queue.queueSave([2]);
  queue.queueSave([3]);
  queue.queueSave([4]);

  await tick(10);
  resolveFirst();
  await tick(600);

  assert.equal(calls.length, 2, 'Two saves total (first + coalesced latest)');
  assert.deepEqual(calls[1], { filled: [4], revision: 1, resultDataUrl: 'data:latest' }, 'Latest snapshot sent with updated revision');
  queue.dispose();
});

test('Multiple pending snapshots coalesce into latest', async () => {
  const calls = [];
  const { promise: firstDone, release: resolveFirst } = barrier();

  const queue = createSaveQueue({
    putProgress: async (p) => {
      calls.push(p);
      if (calls.length === 1) await firstDone;
      return { revision: calls.length };
    },
    getResultDataUrl: () => null,
    onProgress: nop,
    onNotice: nop,
    onSaving: nop,
  });

  queue.reset(0);
  queue.queueSave([1]);
  await tick(500);

  queue.queueSave([2]);
  queue.queueSave([3]);
  queue.queueSave([4]);

  resolveFirst();
  await tick(600);

  assert.equal(calls.length, 2, 'Exactly 2 calls (first + coalesced latest)');
  assert.deepEqual(calls[1], { filled: [4], revision: 1, resultDataUrl: null }, 'Latest sent with updated revision');
  queue.dispose();
});

test('Next snapshot uses revision from previous success', async () => {
  const sentRevisions = [];

  const queue = createSaveQueue({
    putProgress: async (p) => {
      sentRevisions.push(p.revision);
      return { revision: p.revision + 1 };
    },
    getResultDataUrl: () => null,
    onProgress: nop,
    onNotice: nop,
    onSaving: nop,
  });

  queue.reset(3);
  queue.queueSave([1]);
  await tick(500);
  queue.queueSave([2]);
  await tick(500);

  assert.deepEqual(sentRevisions, [3, 4], 'Second used revision 4 from first success');
  queue.dispose();
});

test('Stale success does not replace newer UI progress', async () => {
  let capturedProgress = null;
  const { promise: firstDone, release: resolveFirst } = barrier();
  const calls = [];

  const queue = createSaveQueue({
    putProgress: async (p) => {
      calls.push(p);
      if (calls.length === 1) await firstDone;
      return { revision: calls.length, filled: p.filled };
    },
    getResultDataUrl: () => null,
    onProgress: (p) => { capturedProgress = p; },
    onNotice: nop,
    onSaving: nop,
  });

  queue.reset(0);
  queue.queueSave([1]);
  await tick(500);

  queue.queueSave([2]);
  await tick(500);

  resolveFirst();
  await tick(600);

  assert.ok(capturedProgress, 'Progress was set');
  assert.deepEqual(capturedProgress, { revision: 2, filled: [2] }, 'Latest save applied, not stale first');
  queue.dispose();
});

test('Stale 409 does not decrease revision', async () => {
  const { promise: firstDone, release: resolveFirst } = barrier();
  const calls = [];
  let finalCall = null;

  const queue = createSaveQueue({
    putProgress: async (p) => {
      calls.push(p);
      if (calls.length === 1) {
        await firstDone;
        const e = new Error('Conflict');
        e.status = 409;
        e.data = { progress: { revision: 99 } };
        throw e;
      }
      finalCall = p;
      return { revision: 3 };
    },
    getResultDataUrl: () => null,
    onProgress: nop,
    onNotice: nop,
    onSaving: nop,
  });

  queue.reset(2);
  queue.queueSave([1]);
  await tick(500);

  queue.queueSave([2]);
  await tick(500);

  resolveFirst();
  await tick(600);

  assert.ok(finalCall, 'Latest save was sent');
  assert.equal(finalCall.revision, 2, 'Used original revision=2, not stale 99');
  queue.dispose();
});

test('Current 409 does exactly one retry', async () => {
  const calls = [];
  let noticeText = null;

  const queue = createSaveQueue({
    putProgress: async (p) => {
      calls.push(p);
      if (calls.length <= 2) {
        const e = new Error('Conflict');
        e.status = 409;
        e.data = { progress: { revision: calls.length } };
        throw e;
      }
      return { revision: 5 };
    },
    getResultDataUrl: () => 'data:retry',
    onProgress: nop,
    onNotice: (t) => { noticeText = t; },
    onSaving: nop,
  });

  queue.reset(0);
  queue.queueSave([1]);
  await tick(500);
  await tick(600);

  assert.equal(calls.length, 2, 'Original + 1 retry, stops after second 409');
  assert.ok(noticeText, 'Notice shown after exhausting retries');
  queue.dispose();
});

test('Retry passes same resultDataUrl as original', async () => {
  const calls = [];

  const queue = createSaveQueue({
    putProgress: async (p) => {
      calls.push(p);
      if (calls.length <= 1) {
        const e = new Error('Conflict');
        e.status = 409;
        e.data = { progress: { revision: 5 } };
        throw e;
      }
      return { revision: 6 };
    },
    getResultDataUrl: () => 'data:original-url',
    onProgress: nop,
    onNotice: nop,
    onSaving: nop,
  });

  queue.reset(1);
  queue.queueSave([1, 2]);
  await tick(500);
  await tick(600);

  assert.equal(calls.length, 2, 'Two calls (original + retry)');
  assert.equal(calls[1].resultDataUrl, 'data:original-url', 'Retry uses same resultDataUrl');
  queue.dispose();
});

test('Second 409 does not create infinite loop', async () => {
  const calls = [];
  let noticeCalled = null;

  const queue = createSaveQueue({
    putProgress: async (p) => {
      calls.push(p);
      const e = new Error('Conflict');
      e.status = 409;
      e.data = { progress: { revision: 1 } };
      throw e;
    },
    getResultDataUrl: () => null,
    onProgress: nop,
    onNotice: (t) => { noticeCalled = t; },
    onSaving: nop,
  });

  queue.reset(0);
  queue.queueSave([1]);
  await tick(500);
  await tick(600);

  assert.equal(calls.length, 2, 'Max 2 calls (original + 1 retry)');
  assert.ok(noticeCalled, 'Notice shown after second 409');
  queue.dispose();
});

test('Error of one snapshot does not block newer pending snapshot', async () => {
  const calls = [];
  const { promise: firstDone, release: resolveFirst } = barrier();

  const queue = createSaveQueue({
    putProgress: async (p) => {
      calls.push(p);
      if (calls.length === 1) {
        await firstDone;
        throw new Error('Network failure');
      }
      return { revision: 2 };
    },
    getResultDataUrl: () => null,
    onProgress: nop,
    onNotice: nop,
    onSaving: nop,
  });

  queue.reset(0);
  queue.queueSave([1]);
  await tick(500);

  queue.queueSave([2]);

  resolveFirst();
  await tick(600);

  assert.ok(calls.length >= 2, 'Second save was processed after first error');
  assert.deepEqual(calls[calls.length - 1], { filled: [2], revision: 0, resultDataUrl: null });
  queue.dispose();
});

test('After full drain saving becomes false', async () => {
  const savingStates = [];

  const queue = createSaveQueue({
    putProgress: async () => ({ revision: 1 }),
    getResultDataUrl: () => null,
    onProgress: nop,
    onNotice: nop,
    onSaving: (s) => savingStates.push(s),
  });

  queue.reset(0);
  queue.queueSave([1]);
  await tick(500);

  assert.deepEqual(savingStates, [true, false], 'Saving went true then false after drain');
  queue.dispose();
});

test('Rapid changes before debounce only send latest', async () => {
  const calls = [];

  const queue = createSaveQueue({
    putProgress: async (p) => { calls.push(p); return { revision: 1 }; },
    getResultDataUrl: () => null,
    onProgress: nop,
    onNotice: nop,
    onSaving: nop,
  });

  queue.reset(0);
  queue.queueSave([1]);
  queue.queueSave([2]);
  queue.queueSave([3]);
  queue.queueSave([4]);
  await tick(500);

  assert.equal(calls.length, 1, 'One call after rapid changes');
  assert.deepEqual(calls[0], { filled: [4], revision: 0, resultDataUrl: null });
  queue.dispose();
});

test('reset clears in-flight state', async () => {
  const calls = [];
  const { promise: firstDone, release: resolveFirst } = barrier();
  let resolved = false;

  const queue = createSaveQueue({
    putProgress: async (p) => {
      if (!resolved) {
        calls.push(p);
        await firstDone;
      }
      return { revision: 1 };
    },
    getResultDataUrl: () => null,
    onProgress: nop,
    onNotice: nop,
    onSaving: nop,
  });

  queue.reset(0);
  queue.queueSave([1]);
  await tick(500);

  queue.queueSave([2]);
  await tick(500);

  queue.reset(5);
  resolved = true;
  resolveFirst();
  await tick(600);

  assert.equal(calls.length, 1, 'Old saves stopped after reset');
  queue.dispose();
});

// ── Retry concurrency tests ─────────────────────────────────────────

test('Retry blocks pending snapshots; max 1 concurrent PUT', async () => {
  const calls = [];
  const { promise: retryBlock, release: releaseRetry } = barrier();
  let firstDone = false;

  const queue = createSaveQueue({
    putProgress: async (p) => {
      calls.push(p);
      if (!firstDone) {
        firstDone = true;
        const e = new Error('Conflict');
        e.status = 409;
        e.data = { progress: { revision: 99 } };
        throw e;
      }
      if (calls.length === 2) await retryBlock;
      return { revision: calls.length };
    },
    getResultDataUrl: () => 'data:retry-test',
    onProgress: nop,
    onNotice: nop,
    onSaving: nop,
  });

  queue.reset(0);
  queue.queueSave([1]);
  await tick(500);
  assert.equal(calls.length, 2, 'Original + retry started (still in-flight on retry)');

  queue.queueSave([2]);
  await tick(100);
  assert.equal(calls.length, 2, 'Pending snapshot not started during retry');

  releaseRetry();
  await tick(600);
  assert.equal(calls.length, 3, 'Pending snapshot sent after retry completed');
  queue.dispose();
});

test('onSaving stays true through retry and pending drain', async () => {
  const savingStates = [];
  const { promise: retryBlock, release: releaseRetry } = barrier();
  let firstDone = false;

  const queue = createSaveQueue({
    putProgress: async (p) => {
      if (!firstDone) {
        firstDone = true;
        const e = new Error('Conflict');
        e.status = 409;
        e.data = { progress: { revision: 99 } };
        throw e;
      }
      if (savingStates.filter((s) => s).length === 1) await retryBlock;
      return { revision: 1 };
    },
    getResultDataUrl: () => null,
    onProgress: nop,
    onNotice: nop,
    onSaving: (s) => savingStates.push(s),
  });

  queue.reset(0);
  queue.queueSave([1]);
  await tick(500);

  const trueCountBefore = savingStates.filter((s) => s).length;
  const falseCountBefore = savingStates.filter((s) => !s).length;
  assert.equal(trueCountBefore, falseCountBefore + 1, 'onSaving(true) called once more than onSaving(false)');

  queue.queueSave([2]);

  releaseRetry();
  await tick(600);

  const trueCount = savingStates.filter((s) => s).length;
  const falseCount = savingStates.filter((s) => !s).length;
  assert.equal(trueCount, falseCount, 'onSaving balanced after full drain');
  queue.dispose();
});

// ── Generation / dispose lifecycle tests ─────────────────────────────

test('Old success after reset does not call onProgress', async () => {
  let progressCalls = 0;
  const { promise: block, release: releaseBlock } = barrier();

  const queue = createSaveQueue({
    putProgress: async (p) => {
      await block;
      return { revision: 1, filled: p.filled };
    },
    getResultDataUrl: () => null,
    onProgress: () => { progressCalls += 1; },
    onNotice: nop,
    onSaving: nop,
  });

  queue.reset(0);
  queue.queueSave([1]);
  await tick(500);

  queue.reset(5);
  queue.queueSave([2]);
  await tick(500);

  releaseBlock();
  await tick(600);

  assert.equal(progressCalls, 1, 'Only one onProgress call (new session)');
  queue.dispose();
});

test('Old error after reset does not call onNotice', async () => {
  let noticeCalls = 0;
  const { promise: block, release: releaseBlock } = barrier();

  const queue = createSaveQueue({
    putProgress: async () => {
      await block;
      throw new Error('Stale error');
    },
    getResultDataUrl: () => null,
    onProgress: nop,
    onNotice: () => { noticeCalls += 1; },
    onSaving: nop,
  });

  queue.reset(0);
  queue.queueSave([1]);
  await tick(500);

  queue.reset(5);

  releaseBlock();
  await tick(600);

  assert.equal(noticeCalls, 0, 'Old error notice suppressed');
  queue.dispose();
});

test('Old drain after reset does not call onSaving(false) for new session', async () => {
  const savingStates = [];
  const { promise: block, release: releaseBlock } = barrier();

  const queue = createSaveQueue({
    putProgress: async () => {
      await block;
      return { revision: 1 };
    },
    getResultDataUrl: () => null,
    onProgress: nop,
    onNotice: nop,
    onSaving: (s) => savingStates.push(s),
  });

  queue.reset(0);
  queue.queueSave([1]);
  await tick(500);
  assert.equal(savingStates.length, 1, 'First session: onSaving(true) called');
  assert.equal(savingStates[0], true);

  queue.reset(5);

  releaseBlock();
  await tick(600);

  assert.ok(!savingStates.includes(false), 'Old drain did not call onSaving(false) for new session');
  queue.dispose();
});

test('dispose prevents all future callbacks', async () => {
  let progressCalls = 0;
  let noticeCalls = 0;
  let savingCalls = 0;
  const { promise: block, release: releaseBlock } = barrier();

  const queue = createSaveQueue({
    putProgress: async () => {
      await block;
      return { revision: 1 };
    },
    getResultDataUrl: () => null,
    onProgress: () => { progressCalls += 1; },
    onNotice: () => { noticeCalls += 1; },
    onSaving: () => { savingCalls += 1; },
  });

  queue.reset(0);
  queue.queueSave([1]);
  await tick(500);

  queue.dispose();

  releaseBlock();
  await tick(600);

  assert.equal(progressCalls, 0, 'onProgress not called after dispose');
  assert.equal(noticeCalls, 0, 'onNotice not called after dispose');
  assert.equal(savingCalls, 1, 'Only the initial onSaving(true) before dispose');
  queue.dispose();

  // Calling queueSave after dispose is ignored
  queue.queueSave([9]);
  await tick(500);
  assert.equal(progressCalls, 0, 'No calls after dispose');
});

// ── Revision after stale success tests ───────────────────────────────

test('Pending snapshot uses revision from stale success', async () => {
  const calls = [];
  const { promise: firstDone, release: releaseFirst } = barrier();

  const queue = createSaveQueue({
    putProgress: async (p) => {
      calls.push(p);
      if (calls.length === 1) await firstDone;
      return { revision: calls.length };
    },
    getResultDataUrl: () => null,
    onProgress: nop,
    onNotice: nop,
    onSaving: nop,
  });

  queue.reset(0);
  queue.queueSave([1]);
  await tick(500);
  assert.equal(calls.length, 1, 'First save in flight');

  queue.queueSave([2]);
  await tick(100);
  assert.equal(calls.length, 1, 'Pending not sent yet');

  releaseFirst();
  await tick(600);

  assert.equal(calls.length, 2, 'Pending sent after first completed');
  assert.equal(calls[1].revision, 1, 'Pending used revision=1 from stale success, not 0');
  queue.dispose();
});

test('Stale success updates serverRevision even when UI is newer', async () => {
  const { promise: firstDone, release: releaseFirst } = barrier();
  const calls = [];

  const queue = createSaveQueue({
    putProgress: async (p) => {
      calls.push(p);
      if (calls.length === 1) await firstDone;
      return { revision: 10, filled: p.filled };
    },
    getResultDataUrl: () => null,
    onProgress: nop,
    onNotice: nop,
    onSaving: nop,
  });

  queue.reset(0);
  queue.queueSave([1]);
  await tick(500);

  queue.queueSave([2]);
  await tick(500);

  releaseFirst();
  await tick(600);

  assert.equal(calls.length, 2, 'Pending sent');
  assert.equal(calls[1].revision, 10, 'Pending used revision=10 from stale success');
  queue.dispose();
});
