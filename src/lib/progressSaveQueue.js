import { createProgressJournal } from './progressJournal.js';

const DEBOUNCE_MS = 450;

function makeBatchId() {
  if (globalThis.crypto?.randomUUID) return `batch-${globalThis.crypto.randomUUID()}`;
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createSaveQueue({ putProgress, getResultDataUrl, onProgress, onNotice, onSaving, journal = createProgressJournal(), templateId = null, userScope = null }) {
  const state = {
    inFlight: false,
    pendingFilled: null,
    pendingBatchId: null,
    localVersion: 0,
    serverRevision: 0,
    draining: false,
    drainPromise: null,
    saveTimer: null,
    generation: 0,
    accepting: true,
    disposed: false,
    drainGeneration: 0,
    journalWrites: new Map(),
  };

  function reset(serverRevision) {
    state.generation += 1;
    state.serverRevision = serverRevision;
    state.localVersion = 0;
    state.inFlight = false;
    state.pendingFilled = null;
    state.pendingBatchId = null;
    state.draining = false;
    state.drainPromise = null;
    state.drainGeneration = state.generation;
    state.accepting = true;
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = null;
  }

  function dispose() {
    state.disposed = true;
    state.accepting = false;
    state.generation += 1;
    state.pendingFilled = null;
    state.pendingBatchId = null;
    state.draining = false;
    state.inFlight = false;
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = null;
  }

  function isActive(generation) {
    return generation === state.generation && !state.disposed;
  }

  async function removeJournal(batchId) {
    try { await journal.remove(batchId); } catch { /* journal cleanup is retried by TTL/compaction */ }
  }

  async function waitForJournal(batchId) {
    const write = state.journalWrites.get(batchId);
    if (!write) return;
    await write;
    state.journalWrites.delete(batchId);
  }

  async function drain() {
    if (state.draining || state.disposed) return;
    state.draining = true;
    const gen = state.generation;
    state.drainGeneration = gen;
    while (state.pendingFilled && !state.disposed && gen === state.generation) {
      const snapshotFilled = state.pendingFilled;
      const snapshotBatchId = state.pendingBatchId || makeBatchId();
      const snapshotVersion = state.localVersion;
      const snapshotRevision = state.serverRevision;
      state.pendingFilled = null;
      state.pendingBatchId = null;

      state.inFlight = true;
      if (isActive(gen)) onSaving(true);
      try {
        // The in-memory pending snapshot is cleared above, so do not send it
        // until its durable journal write has settled. This prevents a fast
        // flush from acknowledging/removing a record that was never written.
        await waitForJournal(snapshotBatchId);
        const resultDataUrl = getResultDataUrl(snapshotFilled);
        const saved = await putProgress({
          filled: snapshotFilled,
          revision: snapshotRevision,
          resultDataUrl,
          clientBatchId: snapshotBatchId,
        });
        await removeJournal(snapshotBatchId);
        if (isActive(gen)) {
          state.serverRevision = Math.max(state.serverRevision, Number(saved.revision));
          if (snapshotVersion === state.localVersion) onProgress(saved);
        }
        state.journalWrites.delete(snapshotBatchId);
      } catch (error) {
        state.journalWrites.delete(snapshotBatchId);
        if (isActive(gen) && snapshotVersion === state.localVersion && error.status === 409 && error.data?.progress) {
          await handleConflict(snapshotFilled, snapshotBatchId, snapshotVersion, error, gen);
        } else if (isActive(gen) && snapshotVersion === state.localVersion) {
          onNotice(error.message, 'error');
        }
      }
      state.inFlight = false;
    }
    if (isActive(gen)) onSaving(false);
    if (state.drainGeneration === gen) state.draining = false;
  }

  async function ensureDrain() {
    if (!state.drainPromise || state.drainGeneration !== state.generation) {
      const generation = state.generation;
      let promise;
      promise = drain().finally(() => {
        if (state.drainPromise === promise && state.drainGeneration === generation) state.drainPromise = null;
      });
      state.drainPromise = promise;
      state.drainGeneration = generation;
    }
    return state.drainPromise;
  }

  async function handleConflict(snapshotFilled, snapshotBatchId, snapshotVersion, error, gen) {
    const serverRev = Number(error.data.progress.revision);
    state.serverRevision = Math.max(state.serverRevision, serverRev);
    try {
      const saved = await putProgress({
        filled: snapshotFilled,
        revision: serverRev,
        resultDataUrl: getResultDataUrl(snapshotFilled),
        clientBatchId: snapshotBatchId,
      });
      await removeJournal(snapshotBatchId);
      if (isActive(gen)) {
        state.serverRevision = Math.max(state.serverRevision, Number(saved.revision));
        if (snapshotVersion === state.localVersion) onProgress(saved);
      }
    } catch (retryError) {
      if (isActive(gen) && snapshotVersion === state.localVersion) onNotice(retryError.message || 'Конфликт сохранения', 'error');
    }
  }

  function queueSave(filled, { clientBatchId = makeBatchId(), journalKey = clientBatchId } = {}) {
    if (state.disposed || !state.accepting) return;
    const version = ++state.localVersion;
    state.pendingFilled = [...filled];
    state.pendingBatchId = clientBatchId;
    const writePromise = Promise.resolve(journal.put({
      templateId,
      userScope,
      clientBatchId,
      baseServerRevision: state.serverRevision,
      filled,
      keyOverride: String(journalKey).includes(':') ? journalKey : null,
    }));
    state.journalWrites.set(clientBatchId, writePromise.catch(() => {}));
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      if (version === state.localVersion && !state.disposed) ensureDrain();
    }, DEBOUNCE_MS);
  }

  function flush() {
    if (state.disposed) return Promise.resolve();
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = null;
    if (!state.pendingFilled && !state.drainPromise) return Promise.resolve();
    return ensureDrain();
  }

  async function flushAndDispose() {
    if (state.disposed) return;
    state.accepting = false;
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = null;
    await ensureDrain();
    dispose();
  }

  async function recover({ templateId, serverRevision } = {}) {
    const records = await journal.list();
    const candidates = records.filter((record) => !templateId || !record.templateId || record.templateId === templateId);
    for (const record of candidates.sort((a, b) => Number(a.createdAt) - Number(b.createdAt))) {
      if (!Array.isArray(record.filled)) continue;
      state.serverRevision = Math.max(state.serverRevision, Number(serverRevision ?? record.baseServerRevision ?? 0));
      queueSave(record.filled, { clientBatchId: record.clientBatchId, journalKey: record.key });
    }
    return candidates.length;
  }

  return { queueSave, reset, dispose, flush, flushAndDispose, recover };
}
