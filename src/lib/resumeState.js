import {
  normalizeResumeBeat,
  normalizeSessionDurationBucket,
} from './resumeBeat.js';

export const RESUME_STATE_VERSION = 1;

const CURRENT_KEY_PREFIX = 'splint:resume-current:v1:';
const ARTWORK_KEY_PREFIX = 'splint:resume:v1:';
const ALLOWED_ROUTES = new Set([
  'home',
  'play',
  'catalog',
  'gallery',
  'feed',
  'create',
  'creator',
  'created',
  'manual',
  'packs',
  'profile',
  'collections',
  'achievements',
]);

function encodeKeyPart(value) {
  return encodeURIComponent(String(value || 'anonymous'));
}

function getStorage(storage) {
  if (storage) return storage;
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function getResumeScope(win = typeof window !== 'undefined' ? window : null) {
  const telegramUserId = win?.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  if (telegramUserId != null) return `telegram:${telegramUserId}`;
  return 'anonymous';
}

export function resumeStorageKey(scope, artworkId) {
  return `${ARTWORK_KEY_PREFIX}${encodeKeyPart(scope)}:${encodeKeyPart(artworkId)}`;
}

export function currentResumeStorageKey(scope) {
  return `${CURRENT_KEY_PREFIX}${encodeKeyPart(scope)}`;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizeCamera(camera) {
  if (!camera || typeof camera !== 'object') return null;
  const x = finiteNumber(camera.x);
  const y = finiteNumber(camera.y);
  const zoom = finiteNumber(camera.zoom);
  if (x == null || y == null || zoom == null || zoom <= 0) return null;
  return { x, y, zoom };
}

function normalizeSmartTarget(target) {
  if (!target || typeof target !== 'object') return null;
  const normalized = {
    kind: typeof target.kind === 'string' ? target.kind : null,
    targetId: typeof target.targetId === 'string' ? target.targetId : null,
    tileKey: typeof target.tileKey === 'string' ? target.tileKey : null,
    color: finiteInteger(target.color),
    estimatedCells: finiteInteger(target.estimatedCells),
    anchorX: finiteNumber(target.anchorX),
    anchorY: finiteNumber(target.anchorY),
    bounds: target.bounds && typeof target.bounds === 'object'
      ? {
        minX: finiteNumber(target.bounds.minX),
        minY: finiteNumber(target.bounds.minY),
        maxX: finiteNumber(target.bounds.maxX),
        maxY: finiteNumber(target.bounds.maxY),
      }
      : null,
    workCells: Array.isArray(target.workCells)
      ? target.workCells.filter((index) => Number.isSafeInteger(Number(index))).slice(0, 4096).map(Number)
      : null,
    templateVersion: typeof target.templateVersion === 'string' ? target.templateVersion : null,
  };
  if (!normalized.targetId && !normalized.tileKey && !normalized.workCells?.length) return null;
  return normalized;
}

export function normalizeResumeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const artworkId = typeof snapshot.artworkId === 'string' ? snapshot.artworkId.trim() : '';
  if (!artworkId || Number(snapshot.version || RESUME_STATE_VERSION) !== RESUME_STATE_VERSION) return null;
  const route = ALLOWED_ROUTES.has(snapshot.route) ? snapshot.route : 'play';
  const progressRevision = finiteInteger(snapshot.progressRevision);
  const selectedColor = finiteInteger(snapshot.selectedColor);
  const smartTargetRevision = finiteInteger(snapshot.smartTargetRevision);
  const lastInteractionAt = typeof snapshot.lastInteractionAt === 'string'
    ? snapshot.lastInteractionAt
    : null;
  return {
    version: RESUME_STATE_VERSION,
    artworkId,
    route,
    progressRevision: progressRevision == null ? null : Math.max(0, progressRevision),
    camera: normalizeCamera(snapshot.camera),
    selectedColor: selectedColor == null ? null : Math.max(0, selectedColor),
    smartTarget: normalizeSmartTarget(snapshot.smartTarget),
    nextBeat: normalizeResumeBeat(snapshot.nextBeat),
    smartTargetRevision: smartTargetRevision == null ? null : Math.max(0, smartTargetRevision),
    sessionDurationBucket: normalizeSessionDurationBucket(snapshot.sessionDurationBucket),
    pendingSave: Boolean(snapshot.pendingSave),
    lastInteractionAt,
  };
}

export function mergeResumeSnapshot(previous, patch = {}) {
  return normalizeResumeSnapshot({
    ...(previous || {}),
    ...patch,
    version: RESUME_STATE_VERSION,
  });
}

export function readResumeSnapshot(artworkId, { storage, scope = getResumeScope() } = {}) {
  if (!artworkId) return null;
  const targetStorage = getStorage(storage);
  if (!targetStorage) return null;
  try {
    return normalizeResumeSnapshot(JSON.parse(targetStorage.getItem(resumeStorageKey(scope, artworkId)) || 'null'));
  } catch {
    return null;
  }
}

export function readCurrentResumeSnapshot({ storage, scope = getResumeScope() } = {}) {
  const targetStorage = getStorage(storage);
  if (!targetStorage) return null;
  try {
    const pointer = JSON.parse(targetStorage.getItem(currentResumeStorageKey(scope)) || 'null');
    if (!pointer?.artworkId) return null;
    return readResumeSnapshot(pointer.artworkId, { storage: targetStorage, scope });
  } catch {
    return null;
  }
}

export function writeResumeSnapshot(snapshot, {
  storage,
  scope = getResumeScope(),
  updateCurrent = true,
} = {}) {
  const normalized = normalizeResumeSnapshot(snapshot);
  const targetStorage = getStorage(storage);
  if (!normalized || !targetStorage) return normalized;
  try {
    targetStorage.setItem(resumeStorageKey(scope, normalized.artworkId), JSON.stringify(normalized));
    const currentKey = currentResumeStorageKey(scope);
    if (updateCurrent) {
      targetStorage.setItem(currentKey, JSON.stringify({
        artworkId: normalized.artworkId,
        route: normalized.route,
        savedAt: Date.now(),
      }));
    } else {
      const current = JSON.parse(targetStorage.getItem(currentKey) || 'null');
      if (current?.artworkId === normalized.artworkId) targetStorage.removeItem(currentKey);
    }
  } catch {
    // Safari private mode and storage quota failures must not block painting.
  }
  return normalized;
}

export function clearResumeSnapshot(artworkId, { storage, scope = getResumeScope() } = {}) {
  const targetStorage = getStorage(storage);
  if (!targetStorage || !artworkId) return;
  try {
    targetStorage.removeItem(resumeStorageKey(scope, artworkId));
    const current = JSON.parse(targetStorage.getItem(currentResumeStorageKey(scope)) || 'null');
    if (current?.artworkId === artworkId) targetStorage.removeItem(currentResumeStorageKey(scope));
  } catch {
    // Storage cleanup is best effort.
  }
}

export function isResumeCompatible(snapshot, { artworkId, revision } = {}) {
  const normalized = normalizeResumeSnapshot(snapshot);
  if (!normalized || normalized.artworkId !== artworkId) return false;
  if (revision == null || normalized.progressRevision == null) return false;
  return Number(normalized.progressRevision) === Number(revision);
}
