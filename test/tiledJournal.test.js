import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isJournalQuotaError,
  readTiledJournalEntries,
  tiledJournalStorageKey,
  writeTiledJournalEntries,
} from '../src/lib/tiledJournal.js';

function memoryStorage(options) {
  const quota = Boolean(options && options.quota);
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      if (quota && String(key).startsWith('splint:tiled-progress:')) {
        const error = new Error('Audit storage quota');
        error.name = 'QuotaExceededError';
        throw error;
      }
      data.set(key, String(value));
    },
    removeItem: (key) => { data.delete(key); },
  };
}

const ENTRY = { clientBatchId: 'tiled-1', changes: [{ index: 0, color: 1 }], specialAction: null };

describe('tiled journal durability', () => {
  it('preserves pending journal keys from earlier builds', () => {
    assert.equal(tiledJournalStorageKey('scope:one', 'tpl%one'), 'splint:tiled-progress:scope:one:tpl%one');
  });

  it('reports completely unavailable storage as memory-only', () => {
    const key = tiledJournalStorageKey('audit-user', 'tpl_1');
    assert.deepEqual(readTiledJournalEntries(null, key), []);
    assert.equal(writeTiledJournalEntries(null, key, [ENTRY]).memoryOnly, true);
  });

  it('tiled journal durability: persists entries and reads them back', () => {
    const storage = memoryStorage();
    const key = tiledJournalStorageKey('audit-user', 'tpl_1');
    const result = writeTiledJournalEntries(storage, key, [ENTRY]);
    assert.equal(result.persisted, true);
    assert.equal(result.memoryOnly, false);
    assert.deepEqual(readTiledJournalEntries(storage, key), [ENTRY]);
  });

  it('tiled journal durability: reports QuotaExceededError as memory-only instead of throwing', () => {
    const storage = memoryStorage({ quota: true });
    const key = tiledJournalStorageKey('audit-user', 'tpl_1');
    const result = writeTiledJournalEntries(storage, key, [ENTRY]);
    assert.equal(result.persisted, false);
    assert.equal(result.memoryOnly, true);
    assert.equal(result.quota, true);
    assert.equal(isJournalQuotaError(result.error), true);
  });

  it('tiled journal durability: recovers after quota failure and persists the full queue', () => {
    const backing = new Map();
    let blocked = true;
    const storage = {
      getItem: (key) => (backing.has(key) ? backing.get(key) : null),
      setItem: (key, value) => {
        if (blocked && String(key).startsWith('splint:tiled-progress:')) {
          const error = new Error('Audit storage quota');
          error.name = 'QuotaExceededError';
          throw error;
        }
        backing.set(key, String(value));
      },
      removeItem: (key) => { backing.delete(key); },
    };
    const key = tiledJournalStorageKey('audit-user', 'tpl_1');
    const failed = writeTiledJournalEntries(storage, key, [ENTRY]);
    assert.equal(failed.persisted, false);
    assert.equal(failed.memoryOnly, true);
    blocked = false;
    const recovered = writeTiledJournalEntries(storage, key, [ENTRY]);
    assert.equal(recovered.persisted, true);
    assert.equal(recovered.memoryOnly, false);
    assert.deepEqual(readTiledJournalEntries(storage, key), [ENTRY]);
  });

  it('tiled journal durability: clearing an empty queue removes the stored key', () => {
    const storage = memoryStorage();
    const key = tiledJournalStorageKey('audit-user', 'tpl_1');
    writeTiledJournalEntries(storage, key, [ENTRY]);
    const cleared = writeTiledJournalEntries(storage, key, []);
    assert.equal(cleared.persisted, true);
    assert.deepEqual(readTiledJournalEntries(storage, key), []);
  });
});
