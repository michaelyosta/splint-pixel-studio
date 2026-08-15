import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorWorkerClient } from '../src/lib/creatorWorkerClient.js';

test('creator worker client forwards progress and terminates stale workers on supersede and cancel', { concurrency: false }, async () => {
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
    assert.deepEqual(progress, [{ stage: 'sampling', progress: 0.2 }]);

    const second = client.run('file', { stylePreset: 'paintable' });
    const secondWorker = FakeWorker.instances[1];
    assert.equal(firstWorker.terminated, true);
    await assert.rejects(first, { name: 'AbortError' });
    secondWorker.onmessage({ data: { id: 2, type: 'result', data: { resultFingerprint: 'two' } } });
    assert.deepEqual(await second, { resultFingerprint: 'two' });

    const third = client.run('file', { stylePreset: 'paintable' });
    client.cancel();
    assert.equal(secondWorker.terminated, true);
    await assert.rejects(third, { name: 'AbortError' });
    assert.equal(FakeWorker.instances.length, 3, 'cancel keeps the client reusable with a fresh worker');
    client.dispose();
    assert.equal(FakeWorker.instances[2].terminated, true);
  } finally {
    globalThis.Worker = previousWorker;
  }
});
