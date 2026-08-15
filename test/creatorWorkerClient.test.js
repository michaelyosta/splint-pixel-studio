import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorWorkerClient } from '../src/lib/creatorWorkerClient.js';

test('creator worker client forwards progress and terminates stale workers on cancellation', { concurrency: false }, async () => {
  const previousWorker = globalThis.Worker;
  class FakeWorker {
    static instances = [];

    constructor() {
      this.messages = [];
      this.terminated = false;
      FakeWorker.instances.push(this);
    }

    postMessage(message) { this.messages.push(message); }

    terminate() { this.terminated = true; }
  }
  globalThis.Worker = FakeWorker;
  try {
    const client = createCreatorWorkerClient();
    const firstWorker = FakeWorker.instances[0];
    const progress = [];
    const first = client.run('file', { stylePreset: 'paintable' }, { onProgress: (event) => progress.push(event) });
    firstWorker.onmessage({ data: { id: 1, type: 'progress', progress: { stage: 'sampling', progress: 0.2 } } });
    firstWorker.onmessage({ data: { id: 1, type: 'result', data: { resultFingerprint: 'one' } } });
    assert.deepEqual(await first, { resultFingerprint: 'one' });
    assert.deepEqual(progress, [{ stage: 'sampling', progress: 0.2 }]);

    const second = client.run('file', { stylePreset: 'paintable' });
    const secondWorker = firstWorker;
    assert.equal(firstWorker.terminated, false);
    client.cancel();
    assert.equal(secondWorker.terminated, true);
    await assert.rejects(second, { name: 'AbortError' });
    assert.equal(FakeWorker.instances.length, 2, 'cancel keeps the client reusable with a fresh worker');
    client.dispose();
    assert.equal(FakeWorker.instances[1].terminated, true);
  } finally {
    globalThis.Worker = previousWorker;
  }
});
