const DEBOUNCE_MS = 450;

export function createSaveQueue({ putProgress, getResultDataUrl, onProgress, onNotice, onSaving }) {
  const state = {
    inFlight: false,
    pendingFilled: null,
    localVersion: 0,
    serverRevision: 0,
    draining: false,
    saveTimer: null,
  };

  function reset(serverRevision) {
    state.serverRevision = serverRevision;
    state.localVersion = 0;
    state.inFlight = false;
    state.pendingFilled = null;
    state.draining = false;
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = null;
  }

  async function drain() {
    if (state.draining) return;
    state.draining = true;

    while (state.pendingFilled) {
      const snapshotFilled = state.pendingFilled;
      const snapshotVersion = state.localVersion;
      const snapshotRevision = state.serverRevision;
      state.pendingFilled = null;

      state.inFlight = true;
      onSaving(true);

      try {
        const resultDataUrl = getResultDataUrl(snapshotFilled);
        const saved = await putProgress({
          filled: snapshotFilled,
          revision: snapshotRevision,
          resultDataUrl,
        });
        if (snapshotVersion === state.localVersion) {
          if (saved.revision > state.serverRevision) {
            state.serverRevision = saved.revision;
          }
          onProgress(saved);
        }
      } catch (error) {
        if (snapshotVersion === state.localVersion && error.status === 409 && error.data?.progress) {
          handleConflict(snapshotFilled, snapshotVersion, error);
        } else if (snapshotVersion === state.localVersion) {
          onNotice(error.message, 'error');
        }
      }

      state.inFlight = false;
    }

    onSaving(false);
    state.draining = false;
  }

  async function handleConflict(snapshotFilled, snapshotVersion, error) {
    const serverRev = error.data.progress.revision;
    if (serverRev > state.serverRevision) {
      state.serverRevision = serverRev;
    }

    const resultDataUrl = getResultDataUrl(snapshotFilled);

    try {
      const saved = await putProgress({
        filled: snapshotFilled,
        revision: serverRev,
        resultDataUrl,
      });
      if (snapshotVersion === state.localVersion) {
        if (saved.revision > state.serverRevision) {
          state.serverRevision = saved.revision;
        }
        onProgress(saved);
      }
    } catch (retryError) {
      if (snapshotVersion === state.localVersion) {
        onNotice(retryError.message || 'Конфликт сохранения', 'error');
      }
    }
  }

  function queueSave(filled) {
    const version = ++state.localVersion;
    state.pendingFilled = filled;

    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      if (version === state.localVersion) {
        drain();
      }
    }, DEBOUNCE_MS);
  }

  return { queueSave, reset };
}
