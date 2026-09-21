/**
 * Serialize low-priority analytics requests so telemetry cannot occupy every
 * browser connection and starve navigation, catalog, profile, or player data.
 * A rejected task does not poison the queue.
 */
export function createSerialRequestQueue() {
  let tail = Promise.resolve();

  return function enqueue(task) {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  };
}


/**
 * Coalesce low-priority telemetry into bounded batches while keeping at most
 * one analytics request in flight. Each caller still gets a promise for the
 * batch that contains its event.
 */
export function createAnalyticsBatcher(sendBatch, {
  maxBatchSize = 25,
  flushDelayMs = 60,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let pending = [];
  let timer = null;
  const enqueueRequest = createSerialRequestQueue();

  function flush() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (!pending.length) return Promise.resolve(null);

    const batch = pending.splice(0, maxBatchSize);
    const events = batch.map((item) => item.event);
    const result = enqueueRequest(() => sendBatch(events));
    result.then(
      (value) => batch.forEach((item) => item.resolve(value)),
      (error) => batch.forEach((item) => item.reject(error)),
    );
    if (pending.length) timer = setTimer(flush, flushDelayMs);
    return result;
  }

  function track(event) {
    return new Promise((resolve, reject) => {
      pending.push({ event, resolve, reject });
      if (pending.length >= maxBatchSize) {
        flush();
        return;
      }
      if (timer === null) timer = setTimer(flush, flushDelayMs);
    });
  }

  return { track, flush };
}
