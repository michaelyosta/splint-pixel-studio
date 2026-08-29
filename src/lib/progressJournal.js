const DB_NAME = 'splint-progress-journal';
const STORE_NAME = 'batches';
const DB_VERSION = 1;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 20;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function memoryStore() {
  const records = new Map();
  return {
    async put(record) { records.set(record.key, record); },
    async remove(key) { records.delete(key); },
    async list(scope) { return [...records.values()].filter((record) => record.scope === scope); },
  };
}

function openIndexedDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('scope_created_at', ['scope', 'createdAt']);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbStore(db) {
  const transaction = (mode) => db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  return {
    put(record) {
      return new Promise((resolve, reject) => {
        const request = transaction('readwrite').put(record);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    },
    remove(key) {
      return new Promise((resolve, reject) => {
        const request = transaction('readwrite').delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    },
    list(scope) {
      return new Promise((resolve, reject) => {
        const request = transaction('readonly').getAll();
        request.onsuccess = () => resolve(request.result.filter((record) => record.scope === scope));
        request.onerror = () => reject(request.error);
      });
    },
  };
}

export function createProgressJournal({ scope, ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const journalScope = String(scope || 'anonymous');
  const fallback = memoryStore();
  let storePromise;
  const getStore = () => {
    if (!storePromise) {
      storePromise = openIndexedDb().then((db) => db ? idbStore(db) : fallback).catch(() => fallback);
    }
    return storePromise;
  };

  async function compact() {
    const store = await getStore();
    const now = Date.now();
    const records = (await store.list(journalScope))
      .filter((record) => now - Number(record.createdAt) <= ttlMs)
      .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
    let totalBytes = 0;
    for (const record of records.slice(0, maxEntries)) {
      const bytes = JSON.stringify(record).length;
      if (totalBytes + bytes > maxBytes) {
        await store.remove(record.key);
        continue;
      }
      totalBytes += bytes;
    }
    for (const record of records.slice(maxEntries)) await store.remove(record.key);
  }

  return {
    async put({ templateId, userScope, clientBatchId, baseServerRevision, baseFilled = null, filled, changes = null, specialAction = null, state = 'pending', keyOverride = null }) {
      const key = keyOverride || `${journalScope}:${clientBatchId}`;
      const record = {
        key,
        scope: journalScope,
        templateId,
        userScope,
        clientBatchId,
        baseServerRevision,
        baseFilled: Array.isArray(baseFilled) ? [...baseFilled] : null,
        filled: Array.isArray(filled) ? [...filled] : null,
        changes,
        specialAction,
        createdAt: Date.now(),
        retryCount: 0,
        state,
      };
      await (await getStore()).put(record);
      await compact();
      return key;
    },
    async remove(key) {
      if (key) await (await getStore()).remove(String(key).includes(':') ? key : `${journalScope}:${key}`);
    },
    async list() {
      await compact();
      return (await getStore()).list(journalScope);
    },
  };
}
