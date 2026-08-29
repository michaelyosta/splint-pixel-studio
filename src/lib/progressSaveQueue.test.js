import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSaveQueue,
  isIdempotentReplay,
  isTerminalSpecialError,
  mergeLegacyFilled,
  offerFromProgress,
} from './progressSaveQueue.js';

function withoutBatch(call) {
  const { clientBatchId: _clientBatchId, ...rest } = call;
  return rest;
}

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
  assert.deepEqual(withoutBatch(calls[0]), { filled: [0, 1, 2], revision: 0, resultDataUrl: 'data:test' });
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
  assert.deepEqual(withoutBatch(calls[1]), { filled: [4], revision: 1, resultDataUrl: 'data:latest' }, 'Latest snapshot sent with updated revision');
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
  assert.deepEqual(withoutBatch(calls[1]), { filled: [4], revision: 1, resultDataUrl: null }, 'Latest sent with updated revision');
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
  assert.deepEqual(withoutBatch(calls[calls.length - 1]), { filled: [2], revision: 0, resultDataUrl: null });
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
  assert.deepEqual(withoutBatch(calls[0]), { filled: [4], revision: 0, resultDataUrl: null });
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

test('legacy conflict merge applies local edits only where the server still matches base', () => {
  const local = [1, 2, 3, 4];
  const base = [0, 0, 0, 0];
  const server = [9, 0, 0, 8];
  const merged = mergeLegacyFilled({ local, base, server });
  // index 0: server changed to 9 -> newer server wins
  // index 1: server still base and local changed -> local wins
  // index 2: server still base and local changed -> local wins
  // index 3: server changed to 8 -> newer server wins
  assert.deepEqual(merged, [9, 2, 3, 8]);
});

test('legacy conflict merge keeps server values for unchanged local cells', () => {
  const merged = mergeLegacyFilled({
    local: [0, 2, 0],
    base: [0, 0, 0],
    server: [7, 7, 7],
  });
  assert.deepEqual(merged, [7, 7, 7]);
});

test('legacy conflict merge ignores records without a base snapshot', () => {
  const merged = mergeLegacyFilled({
    local: [1, 2],
    base: null,
    server: [7, 8],
  });
  assert.deepEqual(merged, [7, 8], 'no base means no local stale overwrite');
});

test('legacy conflict merge rejects mismatched snapshot lengths', () => {
  const merged = mergeLegacyFilled({
    local: [1, 2, 3],
    base: [0, 0, 0],
    server: [7, 8],
  });
  assert.deepEqual(merged, [7, 8], 'server shape wins when lengths differ');
});

test('conflict retry merges against journal baseFilled and preserves specialAction', async () => {
  const calls = [];
  const journal = {
    put: async () => {},
    remove: async () => {},
    list: async () => [{
      key: 'batch-merge',
      clientBatchId: 'batch-merge',
      baseFilled: [0, 0, 0, 0],
    }],
  };
  const queue = createSaveQueue({
    putProgress: async (payload) => {
      calls.push(payload);
      if (calls.length === 1) {
        const error = new Error('Conflict');
        error.status = 409;
        error.data = { progress: { revision: 5, filled: [9, 0, 0, 8] } };
        throw error;
      }
      return { revision: 6 };
    },
    getResultDataUrl: () => 'data:merge',
    onProgress: nop,
    onNotice: nop,
    onSaving: nop,
    journal,
  });

  queue.reset(0);
  queue.queueSave([1, 2, 3, 4], {
    clientBatchId: 'batch-merge',
    specialAction: { type: 'claim_spark', special_id: 'sc_x' },
  });
  await tick(500);
  await tick(600);

  assert.equal(calls.length, 2, 'original + one conflict retry');
  assert.deepEqual(calls[1].filled, [9, 2, 3, 8], 'retry uses safe three-way merge');
  assert.equal(calls[1].resultDataUrl, 'data:merge');
  assert.deepEqual(calls[1].specialAction, { type: 'claim_spark', special_id: 'sc_x' });
  queue.dispose();
});

test('conflict retry never stale-overwrites when journal has no baseFilled', async () => {
  const calls = [];
  const journal = {
    put: async () => {},
    remove: async () => {},
    list: async () => [{
      key: 'batch-old',
      clientBatchId: 'batch-old',
    }],
  };
  const queue = createSaveQueue({
    putProgress: async (payload) => {
      calls.push(payload);
      if (calls.length === 1) {
        const error = new Error('Conflict');
        error.status = 409;
        error.data = { progress: { revision: 5, filled: [7, 8] } };
        throw error;
      }
      return { revision: 6 };
    },
    getResultDataUrl: () => null,
    onProgress: nop,
    onNotice: nop,
    onSaving: nop,
    journal,
  });

  queue.reset(0);
  queue.queueSave([1, 2], {
    clientBatchId: 'batch-old',
    specialAction: { type: 'claim_spark', special_id: 'sc_x' },
  });
  await tick(500);
  await tick(600);

  assert.deepEqual(calls[1].filled, [7, 8], 'newer server snapshot wins for legacy records');
  assert.deepEqual(calls[1].specialAction, { type: 'claim_spark', special_id: 'sc_x' }, 'specialAction is preserved');
  queue.dispose();
});

test('flushAndDispose waits for the durable journal write and records its scope', async () => {
  let releaseJournal;
  const journalWritten = new Promise((resolve) => { releaseJournal = resolve; });
  let journalRecord;
  let apiCalls = 0;
  const journal = {
    put: async (record) => {
      journalRecord = record;
      await journalWritten;
    },
    remove: async () => {},
    list: async () => [],
  };
  const queue = createSaveQueue({
    putProgress: async () => { apiCalls += 1; return { revision: 1 }; },
    getResultDataUrl: () => null,
    onProgress: nop,
    onNotice: nop,
    onSaving: nop,
    journal,
    templateId: 'template-1',
    userScope: 'user-1',
  });

  queue.reset(0);
  queue.queueSave([1], { baseFilled: [0] });
  const flush = queue.flushAndDispose();
  await tick(20);
  assert.equal(apiCalls, 0, 'API must wait for the journal acknowledgement');
  assert.equal(journalRecord.templateId, 'template-1');
  assert.equal(journalRecord.userScope, 'user-1');
  assert.deepEqual(journalRecord.baseFilled, [0], 'journal keeps the acknowledged baseline for conflict merge');
  releaseJournal();
  await flush;
  assert.equal(apiCalls, 1);
  queue.queueSave([2]);
  await tick(20);
  assert.equal(apiCalls, 1, 'new snapshots are blocked after shutdown');
});

  test('pagehide suspend does not dispose; pageshow resume replays the journal once and accepts new saves', async () => {
    const calls = [];
    const records = new Map();
    const journal = {
      put: async (record) => { records.set(record.key, record); },
      remove: async (key) => {
        for (const [recordKey, record] of records) {
          if (recordKey === key || record.clientBatchId === key) records.delete(recordKey);
        }
      },
      list: async () => [...records.values()],
    };
    let releasePut;
    const putGate = new Promise((resolve) => { releasePut = resolve; });
    const queue = createSaveQueue({
      putProgress: async (payload) => {
        calls.push(payload);
        await putGate;
        return { revision: 1, filled: payload.filled };
      },
      getResultDataUrl: () => null,
      onProgress: nop,
      onNotice: nop,
      onSaving: nop,
      journal,
      templateId: 'template-1',
      userScope: 'user-1',
    });

    queue.reset(0);
    queue.queueSave([1], {
      clientBatchId: 'batch-hidden',
      specialAction: { type: 'use_spark', special_id: 'sc_x' },
    });
    const hidden = queue.suspend();
    await tick(30);
  assert.equal(calls.length, 1, 'pagehide flush starts the durable snapshot');
  assert.equal(calls[0].specialAction.special_id, 'sc_x', 'special action is preserved in the hidden flush');
  assert.ok(hidden instanceof Promise, 'suspend returns the in-flight drain promise');

    queue.queueSave([2], { clientBatchId: 'batch-while-hidden' });
    await tick(30);
    assert.equal(calls.length, 1, 'suspended queue rejects new saves while hidden');

    const shown = queue.resume({ serverRevision: 0 });
    await tick(30);
    assert.equal(calls.length, 1, 'the still-in-flight journal record is not replayed twice');

  releasePut();
  await hidden;
  assert.equal(await shown, true, 'resume accepts the queue again');
  await queue.flush();
    assert.equal(queue.isDisposed(), false, 'pagehide must not permanently dispose the queue');
    assert.equal(records.size, 0, 'resume drains the interrupted journal record');

    queue.queueSave([3], { clientBatchId: 'batch-after-show' });
    await queue.flush();
    assert.equal(calls.length, 2, 'queue accepts and flushes new saves after pageshow resume');
    assert.deepEqual(calls[1].filled, [3]);
    assert.equal(records.size, 0, 'new save is acknowledged and removed after resume');
    queue.dispose();
  });

  test('resume after an ordinary unload dispose stays inert', async () => {
    const journal = {
      put: async () => {},
      remove: async () => {},
      list: async () => [],
    };
    const queue = createSaveQueue({
      putProgress: async () => ({ revision: 1 }),
      getResultDataUrl: () => null,
      onProgress: nop,
      onNotice: nop,
      onSaving: nop,
      journal,
    });
    queue.dispose();
    assert.equal(await queue.resume({ serverRevision: 0 }), false);
    assert.equal(queue.isDisposed(), true);
  });

// в”Ђв”Ђ Special replay/offer/poison helpers в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

test('idempotent replay flag suppresses repeat special analytics', () => {
  assert.equal(isIdempotentReplay({ idempotent: true }), true);
  assert.equal(isIdempotentReplay({ idempotent: false }), false);
  assert.equal(isIdempotentReplay({ special_offer: { special_id: 'sc_x' } }), false);
  assert.equal(isIdempotentReplay(null), false);
});

test('progress special_offer restores the UI offer and null clears stale UI', () => {
  const offer = { special_id: 'sc_x', target_options: [{ option_id: 'a' }] };
  assert.equal(offerFromProgress({ special_offer: offer }), offer);
  assert.equal(offerFromProgress({ special_offer: null }), null);
  assert.equal(offerFromProgress({ revision: 4 }), null);
  assert.equal(offerFromProgress(null), null);
});

test('terminal special 409 codes are recognized; ordinary conflicts are not', () => {
  for (const code of [
    'SPECIAL_OFFER_STALE',
    'SPECIAL_CLAIM_INVALID',
    'SPECIAL_TARGET_STALE',
    'SPECIAL_TARGET_EMPTY',
    'SPECIAL_COHORT_CONTROL',
  ]) {
    const error = new Error(code);
    error.status = 409;
    error.data = { code };
    assert.equal(isTerminalSpecialError(error), true, code);
  }

  const cas = new Error('Conflict');
  cas.status = 409;
  cas.data = { progress: { revision: 3 } };
  assert.equal(isTerminalSpecialError(cas), false, 'CAS conflict remains retryable');

  const unknown = new Error('Unknown');
  unknown.status = 409;
  unknown.data = { code: 'SOME_OTHER_CODE' };
  assert.equal(isTerminalSpecialError(unknown), false);

  const offline = new Error('Network is unavailable');
  offline.status = 0;
  assert.equal(isTerminalSpecialError(offline), false);
});

test('terminal special 409 drops the journal entry without retry and rejects once', async () => {
  const calls = [];
  const removed = [];
  const notices = [];
  const rejected = [];
  const journal = {
    put: async () => {},
    remove: async (key) => { removed.push(key); },
    list: async () => [],
  };
  const queue = createSaveQueue({
    putProgress: async () => {
      calls.push('put');
      const error = new Error('Spark offer is no longer available');
      error.status = 409;
      error.data = { code: 'SPECIAL_OFFER_STALE' };
      throw error;
    },
    getResultDataUrl: () => null,
    onProgress: nop,
    onNotice: (message) => { notices.push(message); },
    onSpecialRejected: (error) => { rejected.push(error.data.code); },
    onSaving: nop,
    journal,
  });

  queue.reset(0);
  queue.queueSave([1], {
    clientBatchId: 'batch-poison',
    specialAction: { type: 'use_spark', special_id: 'sc_x' },
  });
  await tick(500);
  await tick(600);

  assert.equal(calls.length, 1, 'terminal special is never retried');
  assert.equal(removed.length, 1, 'durable journal record is dropped');
  assert.deepEqual(rejected, ['SPECIAL_OFFER_STALE'], 'bounded rejection surfaced');
  assert.deepEqual(notices, [], 'ordinary error notice is not emitted');

  await queue.recover({ templateId: 'template-1', serverRevision: 0 });
  await tick(500);
  assert.equal(calls.length, 1, 'poisoned entry is not replayed after recovery');
  queue.dispose();
});

test('terminal special 409 adopts server progress when the payload includes it', async () => {
  const removed = [];
  const progressCalls = [];
  const journal = {
    put: async () => {},
    remove: async (key) => { removed.push(key); },
    list: async () => [],
  };
  const queue = createSaveQueue({
    putProgress: async () => {
      const error = new Error('Spark offer is no longer available');
      error.status = 409;
      error.data = {
        code: 'SPECIAL_OFFER_STALE',
        progress: { revision: 7, filled: [1, 2, 3], percent: 40 },
      };
      throw error;
    },
    getResultDataUrl: () => null,
    onProgress: (progress) => { progressCalls.push(progress); },
    onNotice: nop,
    onSpecialRejected: nop,
    onSaving: nop,
    journal,
  });

  queue.reset(2);
  queue.queueSave([9], {
    clientBatchId: 'batch-adopt',
    specialAction: { type: 'skip_spark', special_id: 'sc_x' },
  });
  await tick(500);
  await tick(600);

  assert.equal(removed.length, 1);
  assert.equal(progressCalls.length, 1, 'server progress adopted');
  assert.equal(progressCalls[0].revision, 7);
  assert.equal(progressCalls[0].filled[0], 1);
  queue.dispose();
});

test('non-terminal failure keeps the journal entry for a later retry', async () => {
  const calls = [];
  const removed = [];
  const journal = {
    put: async () => {},
    remove: async (key) => { removed.push(key); },
    list: async () => [],
  };
  const queue = createSaveQueue({
    putProgress: async () => {
      calls.push('put');
      throw new Error('Network failure');
    },
    getResultDataUrl: () => null,
    onProgress: nop,
    onNotice: nop,
    onSaving: nop,
    journal,
  });

  queue.reset(0);
  queue.queueSave([1], { clientBatchId: 'batch-network' });
  await tick(500);
  await tick(600);

  assert.equal(calls.length, 1);
  assert.equal(removed.length, 0, 'network/offline entry stays durable');
  queue.dispose();
});
