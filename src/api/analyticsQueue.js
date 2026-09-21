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
