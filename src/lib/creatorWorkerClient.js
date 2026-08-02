export function createCreatorWorkerClient() {
  if (typeof Worker === 'undefined') return null;
  const worker = new Worker(new URL('../workers/creatorPipeline.worker.js', import.meta.url), { type: 'module' });
  let generation = 0;
  let sequence = 0;
  const pending = new Map();
  worker.onmessage = (event) => {
    const { id, type, data, error } = event.data || {};
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (type === 'error') request.reject(new Error(error));
    else request.resolve(data);
  };
  worker.onerror = (error) => {
    for (const request of pending.values()) request.reject(error.error || new Error('Creator worker failed'));
    pending.clear();
  };
  return {
    run(file, options) {
      const id = ++sequence;
      const nextGeneration = ++generation;
      for (const request of pending.values()) request.reject(new DOMException('Superseded', 'AbortError'));
      pending.clear();
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, generation: nextGeneration, file, options });
      });
    },
    cancel() {
      generation += 1;
      for (const request of pending.values()) request.reject(new DOMException('Cancelled', 'AbortError'));
      pending.clear();
    },
    dispose() {
      this.cancel();
      worker.terminate();
    },
  };
}

