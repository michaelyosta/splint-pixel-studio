const DEBOUNCE_MS = 450;

export function createSaveQueue({ putProgress, getResultDataUrl, onProgress, onNotice, onSaving }) {
  const state = {
    inFlight: false,
    pendingFilled: null,
    localVersion: 0,
    serverRevision: 0,
    draining: false,
    saveTimer: null,
    generation: 0,
    disposed: false,
  };

  function reset(serverRevision) {
    state.generation += 1;
    state.serverRevision = serverRevision;
    state.localVersion = 0;
    state.inFlight = false;
    state.pendingFilled = null;
    state.draining = false;
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = null;
  }

  function dispose() {
    state.disposed = true;
    state.generation += 1;
    state.pendingFilled = null;
    state.draining = false;
    state.inFlight = false;
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = null;
  }

  function isActive(generation) {
    return generation === state.generation && !state.disposed;
  }

  async function drain() {
    if (state.draining || state.disposed) return;
    state.draining = true;
    const gen = state.generation;

    while (state.pendingFilled && !state.disposed && gen === state.generation) {
      const snapshotFilled = state.pendingFilled;
      const snapshotVersion = state.localVersion;
      const snapshotRevision = state.serverRevision;
      state.pendingFilled = null;

      state.inFlight = true;
      if (isActive(gen)) onSaving(true);

      try {
        const resultDataUrl = getResultDataUrl(snapshotFilled);
        const saved = await putProgress({
          filled: snapshotFilled,
          revision: snapshotRevision,
          resultDataUrl,
        });

        if (isActive(gen)) {
          state.serverRevision = Math.max(state.serverRevision, Number(saved.revision));
          if (snapshotVersion === state.localVersion) {
            onProgress(saved);
          }
        }
      } catch (error) {
        if (isActive(gen) && snapshotVersion === state.localVersion && error.status === 409 && error.data?.progress) {
          await handleConflict(snapshotFilled, snapshotVersion, error, gen);
        } else if (isActive(gen) && snapshotVersion === state.localVersion) {
          onNotice(error.message, 'error');
        }
      }

      state.inFlight = false;
    }

    if (isActive(gen)) {
      onSaving(false);
    }
    state.draining = false;
  }

  async function handleConflict(snapshotFilled, snapshotVersion, error, gen) {
    const serverRev = Number(error.data.progress.revision);
    state.serverRevision = Math.max(state.serverRevision, serverRev);

    const resultDataUrl = getResultDataUrl(snapshotFilled);

    try {
      const saved = await putProgress({
        filled: snapshotFilled,
        revision: serverRev,
        resultDataUrl,
      });

      if (isActive(gen)) {
        state.serverRevision = Math.max(state.serverRevision, Number(saved.revision));
        if (snapshotVersion === state.localVersion) {
          onProgress(saved);
        }
      }
    } catch (retryError) {
      if (isActive(gen) && snapshotVersion === state.localVersion) {
        onNotice(retryError.message || 'Конфликт сохранения', 'error');
      }
    }
  }

  function queueSave(filled) {
    if (state.disposed) return;
    const version = ++state.localVersion;
    state.pendingFilled = filled;

    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      if (version === state.localVersion && !state.disposed) {
        drain();
      }
    }, DEBOUNCE_MS);
  }

  return { queueSave, reset, dispose };
}
