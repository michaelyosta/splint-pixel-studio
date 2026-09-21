export function createAnalyticsBatcher({
  send,
  delayMs = 80,
  maxBatchSize = 25,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  if (typeof send !== 'function') throw new TypeError('send must be a function');

  let queue = [];
  let timer = null;
  let flushing = false;
  let disposed = false;

  const schedule = () => {
    if (disposed || flushing || timer !== null || !queue.length) return;
    timer = setTimer(() => {
      timer = null;
      void flush();
    }, delayMs);
  };

  async function flush() {
    if (disposed || flushing || !queue.length) return;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    const batch = queue.splice(0, maxBatchSize);
    flushing = true;
    try {
      await send(batch);
    } catch {
      // Analytics must never block product navigation or gameplay.
    } finally {
      flushing = false;
      if (queue.length) schedule();
    }
  }

  return {
    track(event, payload = {}) {
      if (disposed || typeof event !== 'string' || !event) return;
      queue.push({ event, payload });
      if (queue.length >= maxBatchSize && !flushing) {
        void flush();
        return;
      }
      schedule();
    },
    flush,
    pendingCount() {
      return queue.length;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      const pending = queue.splice(0, queue.length);
      if (pending.length) Promise.resolve(send(pending)).catch(() => {});
    },
  };
}
