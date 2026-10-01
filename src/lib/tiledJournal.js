// Durable tiled progress journal over synchronous key-value storage.
//
// The tiled player keeps unsent paint batches in memory and mirrors them to
// persistent storage so an offline stroke survives a reload. Storage writes
// can fail (quota, privacy mode, unavailable storage). Callers must know
// whether the mirror survived: a silent catch turns "saved locally" into a
// promise the next boot cannot keep. Every function here reports durability
// explicitly and never throws for storage failures.

export const TILED_JOURNAL_KEY_PREFIX = 'splint:tiled-progress:';

export function tiledJournalStorageKey(userScope, templateId) {
  return TILED_JOURNAL_KEY_PREFIX + encodeURIComponent(String(userScope || 'anonymous')) + ':' + encodeURIComponent(String(templateId));
}

export function isJournalQuotaError(error) {
  if (!error) return false;
  const name = String(error && error.name ? error.name : '');
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  const code = Number(error && error.code ? error.code : NaN);
  if (code === 22 || code === 1014) return true;
  return false;
}

export function readTiledJournalEntries(storage, key) {
  let raw = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return [];
  }
  if (raw == null || raw === '') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Returns persisted/memoryOnly/error/quota. persisted is true when the
// entries are durably mirrored (or there is nothing to mirror). memoryOnly
// is true when entries exist only in memory and a reload would lose them.
export function writeTiledJournalEntries(storage, key, entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) {
    try {
      storage.removeItem(key);
    } catch {
      // Nothing is pending, so a failed cleanup cannot lose progress.
    }
    return { persisted: true, memoryOnly: false, error: null, quota: false };
  }
  let serialized = null;
  try {
    serialized = JSON.stringify(list);
  } catch (error) {
    return { persisted: false, memoryOnly: true, error: error, quota: false };
  }
  try {
    storage.setItem(key, serialized);
    return { persisted: true, memoryOnly: false, error: null, quota: false };
  } catch (error) {
    return { persisted: false, memoryOnly: true, error: error, quota: isJournalQuotaError(error) };
  }
}
