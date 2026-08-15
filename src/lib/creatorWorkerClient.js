export function createCreatorWorkerClient() {
  if (typeof Worker === 'undefined') return null;
  let generation = 0;
  let sequence = 0;
  const pending = new Map();
  let worker = null;
  const spawnWorker = () => {
    const nextWorker = new Worker(new URL('../workers/creatorPipeline.worker.js', import.meta.url), { type: 'module' });
    nextWorker.onmessage = (event) => {
      const { id, type, data, error, progress } = event.data || {};
      const request = pending.get(id);
      if (!request) return;
      if (type === 'progress') {
        request.onProgress?.(progress);
        return;
      }
      pending.delete(id);
      if (type === 'error') request.reject(new Error(error));
      else request.resolve(data);
    };
    nextWorker.onerror = (error) => {
      if (nextWorker !== worker) return;
      for (const request of pending.values()) request.reject(error.error || new Error('Creator worker failed'));
      pending.clear();
    };
    return nextWorker;
  };
  worker = spawnWorker();
  return {
    run(file, options, { onProgress } = {}) {
      const id = ++sequence;
      const nextGeneration = ++generation;
      const hadPendingWork = pending.size > 0;
      for (const request of pending.values()) request.reject(new DOMException('Superseded', 'AbortError'));
      pending.clear();
      if (hadPendingWork && worker) {
        worker.postMessage({ type: 'cancel', generation: nextGeneration });
        worker.terminate();
        worker = null;
      }
      if (!worker) worker = spawnWorker();
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onProgress });
        worker.postMessage({ id, generation: nextGeneration, file, options });
      });
    },
    cancel() {
      generation += 1;
      worker?.postMessage({ type: 'cancel', generation });
      for (const request of pending.values()) request.reject(new DOMException('Cancelled', 'AbortError'));
      pending.clear();
      // Termination covers the short window before a busy worker can service
      // the cancellation message. A fresh worker keeps the client reusable.
      worker?.terminate();
      worker = spawnWorker();
    },
    dispose() {
      generation += 1;
      for (const request of pending.values()) request.reject(new DOMException('Disposed', 'AbortError'));
      pending.clear();
      worker?.terminate();
      worker = null;
    },
  };
}

