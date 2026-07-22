const states = new WeakMap();

function getState(sqlite) {
  let state = states.get(sqlite);
  if (!state) {
    state = { queue: [], lockActive: false };
    states.set(sqlite, state);
  }
  return state;
}

function processQueue(sqlite) {
  const state = getState(sqlite);
  if (state.lockActive || state.queue.length === 0) return;
  state.lockActive = true;
  const next = state.queue.shift();
  next.resolve();
}

function acquireLock(sqlite) {
  const state = getState(sqlite);
  return new Promise((resolve) => {
    state.queue.push({ resolve });
    processQueue(sqlite);
  });
}

function releaseLock(sqlite) {
  const state = getState(sqlite);
  state.lockActive = false;
  processQueue(sqlite);
}

export function scheduleSqliteOperation(sqlite, fn) {
  return acquireLock(sqlite).then(() => {
    let result;
    try {
      result = fn();
    } catch (err) {
      releaseLock(sqlite);
      throw err;
    }
    if (result && typeof result.then === 'function') {
      return result.then(
        (value) => { releaseLock(sqlite); return value; },
        (err) => { releaseLock(sqlite); throw err; },
      );
    }
    releaseLock(sqlite);
    return result;
  });
}

export function isSqliteLocked(sqlite) {
  const state = getState(sqlite);
  return state.lockActive;
}
