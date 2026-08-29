import { createProgressJournal } from './progressJournal.js';

const DEBOUNCE_MS = 450;

const TERMINAL_SPECIAL_CODES = new Set([
  'SPECIAL_OFFER_STALE',
  'SPECIAL_CLAIM_INVALID',
  'SPECIAL_TARGET_STALE',
  'SPECIAL_TARGET_EMPTY',
  'SPECIAL_COHORT_CONTROL',
]);

function makeBatchId() {
  if (globalThis.crypto?.randomUUID) return `batch-${globalThis.crypto.randomUUID()}`;
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isTerminalSpecialError(error) {
  return Boolean(error?.status === 409 && error.data && TERMINAL_SPECIAL_CODES.has(error.data.code));
}

export function isIdempotentReplay(saved) {
  return Boolean(saved && saved.idempotent === true);
}

export function offerFromProgress(progress) {
  return progress?.special_offer || null;
}

function sameLengthFilled(base, server) {
  return Array.isArray(base) && Array.isArray(server) && base.length === server.length;
}

/**
 * Pure three-way merge for a legacy full snapshot.
 *
 * Only cells where the local edit differs from the journal base are treated
 * as local changes. If the server still has the base value at that cell, the
 * local change is safe to apply. If the server changed the cell first, the
 * newer server value wins and the local edit is discarded for that cell.
 * Records without a base are intentionally ignored, so an old journal entry
 * can never stale-overwrite a newer server snapshot.
 */
export function mergeLegacyFilled({ local, base, server }) {
  if (!sameLengthFilled(server, local) || !sameLengthFilled(server, base)) {
    return server ? [...server] : local;
  }
  const merged = [...server];
  for (let index = 0; index < local.length; index += 1) {
    const baseValue = base[index];
    if (local[index] === baseValue) continue;
    if (server[index] === baseValue) merged[index] = local[index];
  }
  return merged;
}

export function createSaveQueue({
  putProgress,
  getResultDataUrl,
  onProgress,
  onNotice,
  onSaving,
  onSpecialRejected,
  journal = createProgressJournal(),
  templateId = null,
  userScope = null,
}) {
  const state = {
    inFlight: false,
    inFlightBatchId: null,
    pendingFilled: null,
    pendingBatchId: null,
    pendingBaseFilled: null,
    pendingSpecialAction: null,
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
    state.pendingBaseFilled = null;
    state.pendingSpecialAction = null;
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
    state.pendingBaseFilled = null;
    state.pendingSpecialAction = null;
    state.draining = false;
    state.inFlight = false;
    state.inFlightBatchId = null;
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
      const snapshotBaseFilled = state.pendingBaseFilled;
      const snapshotSpecialAction = state.pendingSpecialAction;
      const snapshotVersion = state.localVersion;
      const snapshotRevision = state.serverRevision;
      state.pendingFilled = null;
      state.pendingBatchId = null;
      state.pendingBaseFilled = null;
      state.pendingSpecialAction = null;

      state.inFlight = true;
      state.inFlightBatchId = snapshotBatchId;
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
          ...(snapshotSpecialAction ? { specialAction: snapshotSpecialAction } : {}),
        });
        await removeJournal(snapshotBatchId);
        if (isActive(gen)) {
          state.serverRevision = Math.max(state.serverRevision, Number(saved.revision));
          if (snapshotVersion === state.localVersion) onProgress(saved);
        }
        state.journalWrites.delete(snapshotBatchId);
      } catch (error) {
        state.journalWrites.delete(snapshotBatchId);
        if (isActive(gen) && snapshotVersion === state.localVersion && isTerminalSpecialError(error)) {
          await handleTerminalSpecial(snapshotBatchId, snapshotVersion, error, gen);
        } else if (isActive(gen) && snapshotVersion === state.localVersion && error.status === 409 && error.data?.progress) {
          await handleConflict(snapshotFilled, snapshotBaseFilled, snapshotBatchId, snapshotVersion, error, gen, snapshotSpecialAction);
        } else if (isActive(gen) && snapshotVersion === state.localVersion) {
          onNotice(error.message, 'error');
        }
      } finally {
        state.inFlight = false;
        if (state.inFlightBatchId === snapshotBatchId) state.inFlightBatchId = null;
      }
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

  async function handleTerminalSpecial(snapshotBatchId, snapshotVersion, error, gen) {
    // A terminal special rejection can never succeed on retry, so acknowledge
    // the durable journal record and surface the server progress if present.
    await removeJournal(snapshotBatchId);
    const serverProgress = error.data?.progress;
    if (serverProgress) {
      state.serverRevision = Math.max(state.serverRevision, Number(serverProgress.revision ?? state.serverRevision));
    }
    if (isActive(gen) && snapshotVersion === state.localVersion) {
      if (serverProgress) onProgress(serverProgress);
      if (typeof onSpecialRejected === 'function') onSpecialRejected(error);
    }
  }

  async function handleConflict(snapshotFilled, snapshotBaseFilled, snapshotBatchId, snapshotVersion, error, gen, specialAction = null) {
    const serverRev = Number(error.data.progress.revision);
    state.serverRevision = Math.max(state.serverRevision, serverRev);
    try {
      const record = (await journal.list()).find((candidate) => (
        candidate.clientBatchId === snapshotBatchId || candidate.key === snapshotBatchId
      ));
      const baseFilled = Array.isArray(record?.baseFilled)
        ? record.baseFilled
        : snapshotBaseFilled;
      const serverFilled = Array.isArray(error.data.progress.filled) ? error.data.progress.filled : null;
      const merged = baseFilled && serverFilled
        ? mergeLegacyFilled({ local: snapshotFilled, base: baseFilled, server: serverFilled })
        : serverFilled ? [...serverFilled] : snapshotFilled;
      const saved = await putProgress({
        filled: merged,
        revision: serverRev,
        resultDataUrl: getResultDataUrl(merged),
        clientBatchId: snapshotBatchId,
        ...(specialAction ? { specialAction } : {}),
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

  function queueSave(filled, {
    clientBatchId = makeBatchId(),
    journalKey = clientBatchId,
    baseFilled = null,
    specialAction = null,
  } = {}) {
    if (state.disposed || !state.accepting) return;
    const version = ++state.localVersion;
    state.pendingFilled = [...filled];
    state.pendingBatchId = clientBatchId;
    state.pendingBaseFilled = Array.isArray(baseFilled) ? [...baseFilled] : null;
    state.pendingSpecialAction = specialAction;
    const writePromise = Promise.resolve(journal.put({
      templateId,
      userScope,
      clientBatchId,
      baseServerRevision: state.serverRevision,
      baseFilled: Array.isArray(baseFilled) ? [...baseFilled] : null,
      filled,
      specialAction,
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

  /**
   * Pagehide-safe shutdown: stop accepting new snapshots and flush the
   * current one, but do not destroy the queue or its journal. A bfcache
   * pageshow can resume and recover anything that did not finish while hidden.
   */
  function suspend() {
    if (state.disposed) return Promise.resolve(false);
    state.accepting = false;
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = null;
    return ensureDrain();
  }

  /**
   * Bfcache pageshow: accept new saves again and replay any durable journal
   * records that pagehide could not finish. Records already in flight are
   * skipped so a hidden request is not duplicated after the page returns.
   */
  async function resume({ serverRevision } = {}) {
    if (state.disposed) return false;
    state.accepting = true;
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = null;
    await recover({ templateId, serverRevision });
    return true;
  }

  function isDisposed() {
    return state.disposed;
  }

  async function recover({ templateId, serverRevision } = {}) {
    const records = await journal.list();
    const candidates = records.filter((record) => !templateId || !record.templateId || record.templateId === templateId);
    for (const record of candidates.sort((a, b) => Number(a.createdAt) - Number(b.createdAt))) {
      if (!Array.isArray(record.filled)) continue;
      if (state.inFlightBatchId && record.clientBatchId === state.inFlightBatchId) continue;
      state.serverRevision = Math.max(state.serverRevision, Number(serverRevision ?? record.baseServerRevision ?? 0));
      queueSave(record.filled, {
        clientBatchId: record.clientBatchId,
        journalKey: record.key,
        baseFilled: Array.isArray(record.baseFilled) ? record.baseFilled : null,
        specialAction: record.specialAction || null,
      });
    }
    return candidates.length;
  }

  return { queueSave, reset, dispose, flush, flushAndDispose, suspend, resume, isDisposed, recover };
}
