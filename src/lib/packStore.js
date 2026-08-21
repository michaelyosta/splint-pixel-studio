/*
 * Small, server-metadata driven helpers for the Phase 5 pack surface.
 *
 * This module deliberately does not call a payment API.  The server remains
 * authoritative for ownership and the client only presents a paid pack as a
 * showcase while payments are disabled.  Keeping the state derivation and
 * checkout transitions pure makes the disabled-by-default behaviour easy to
 * test and safe to replace with a Telegram Stars adapter later.
 */

export const PACK_STATES = Object.freeze({
  FREE: 'free',
  OWNED: 'owned',
  PAID: 'paid',
  UNAVAILABLE: 'unavailable',
});

export const CHECKOUT_STATES = Object.freeze({
  IDLE: 'idle',
  PENDING: 'pending',
  SUCCESS: 'success',
  CANCELLED: 'cancelled',
  ERROR: 'error',
  RESTORING: 'restoring',
});

// Alias kept for callers that use payment terminology instead of checkout.
export const PAYMENT_STATES = CHECKOUT_STATES;

const VALID_PACK_STATES = new Set(Object.values(PACK_STATES));
const VALID_CHECKOUT_STATES = new Set(Object.values(CHECKOUT_STATES));

function safeString(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function safeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function isPublishedPublic(collection) {
  if (!collection || typeof collection !== 'object') return false;
  // Creator-owned sets are allowed to be private to their owner; the store
  // should never expose an unpublished/private set as a purchasable showcase.
  if (collection.owner_id != null && collection.owner_id !== '') {
    return collection.status === 'published' && collection.visibility === 'public';
  }
  if (collection.status === undefined && collection.visibility === undefined) return true;
  return collection.status === 'published' && collection.visibility === 'public';
}

export function isPackOwned(collection, unlock = null) {
  return Boolean(
    collection?.owned
      || collection?.is_owned
      || collection?.owned_at
      || unlock?.owned
      || unlock?.state === PACK_STATES.OWNED,
  );
}

/**
 * Converts current collection metadata plus the unlock endpoint's subject
 * into one of four bounded display states.  A paid state means “this is a
 * paid pack”; whether checkout is enabled is intentionally separate.
 */
export function getPackState(collection, unlock = null) {
  if (!collection || typeof collection !== 'object') return PACK_STATES.UNAVAILABLE;
  if (isPackOwned(collection, unlock)) return PACK_STATES.OWNED;
  if (!isPublishedPublic(collection)) return PACK_STATES.UNAVAILABLE;

  const packType = safeString(collection.pack_type, 'free').toLowerCase();
  if (packType === 'free') return PACK_STATES.FREE;
  if (packType === 'premium' && safeInteger(collection.price_in_stars) > 0) return PACK_STATES.PAID;
  return PACK_STATES.UNAVAILABLE;
}

function unlockMap(snapshot) {
  const subjects = Array.isArray(snapshot)
    ? snapshot
    : [...(snapshot?.collections || [])];
  return new Map(subjects
    .filter((subject) => subject && subject.subject_type === 'collection' && subject.subject_id)
    .map((subject) => [String(subject.subject_id), subject]));
}

/**
 * Normalizes a collection for rendering while preserving the source fields
 * needed by existing catalog APIs.  The result is safe to pass around as a
 * small card model; no artwork cells or unbounded server payloads are copied.
 */
export function normalizePack(collection, { unlock = null, paymentsMode = 'disabled' } = {}) {
  const source = collection && typeof collection === 'object' ? collection : {};
  const id = safeString(source.id);
  const price = safeInteger(source.price_in_stars);
  const packState = getPackState(source, unlock);
  const paymentMode = safeString(paymentsMode, 'disabled').toLowerCase();
  const checkoutEnabled = packState === PACK_STATES.PAID && paymentMode === 'telegram_stars';
  const total = safeInteger(source.total_count ?? source.total_artworks);
  const completed = Math.min(total, safeInteger(source.completed_count));

  return {
    ...source,
    id,
    title: safeString(source.title, 'Без названия'),
    description: safeString(source.description),
    pack_type: safeString(source.pack_type, 'free').toLowerCase(),
    rarity: safeString(source.rarity, 'common'),
    price_in_stars: price,
    total_count: total,
    completed_count: completed,
    pack_state: packState,
    owned: packState === PACK_STATES.OWNED,
    checkout_enabled: checkoutEnabled,
    payments_mode: paymentMode,
    unlock_state: unlock?.state || null,
    unlock_reason_code: unlock?.reason_code || null,
  };
}

/**
 * Keeps the store intentionally small: all eligible free/owned packs plus at
 * most one paid showcase.  Invalid/private rows are omitted instead of
 * becoming confusing dead-end cards.
 */
export function normalizeStorePacks(collections, snapshot = null, {
  limit = 12,
  paidLimit = 1,
  paymentsMode = 'disabled',
} = {}) {
  const max = Math.min(24, Math.max(1, safeInteger(limit, 12)));
  const paidMax = Math.min(1, Math.max(0, safeInteger(paidLimit, 1)));
  const byId = unlockMap(snapshot);
  const seen = new Set();
  const normalized = [];
  for (const collection of Array.isArray(collections) ? collections : []) {
    const id = safeString(collection?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const pack = normalizePack(collection, {
      unlock: byId.get(id),
      paymentsMode,
    });
    if (pack.pack_state === PACK_STATES.UNAVAILABLE) continue;
    normalized.push(pack);
  }

  const showcase = normalized.filter((pack) => pack.pack_state === PACK_STATES.PAID).slice(0, paidMax);
  const rest = normalized.filter((pack) => pack.pack_state !== PACK_STATES.PAID);
  return [...showcase, ...rest].slice(0, max);
}

export function packStateLabel(state) {
  switch (state) {
    case PACK_STATES.FREE: return 'Бесплатно';
    case PACK_STATES.OWNED: return 'Открыто';
    case PACK_STATES.PAID: return 'Платный набор';
    case PACK_STATES.UNAVAILABLE: return 'Недоступно';
    default: return 'Набор';
  }
}

export function checkoutStateLabel(state) {
  switch (state) {
    case CHECKOUT_STATES.PENDING: return 'Проверяем доступ…';
    case CHECKOUT_STATES.SUCCESS: return 'Доступ подтверждён';
    case CHECKOUT_STATES.CANCELLED: return 'Покупка отменена';
    case CHECKOUT_STATES.ERROR: return 'Не удалось подтвердить покупку';
    case CHECKOUT_STATES.RESTORING: return 'Восстанавливаем покупки…';
    default: return '';
  }
}

export function canCheckout(pack, paymentsMode = pack?.payments_mode) {
  return Boolean(
    pack
      && pack.pack_state === PACK_STATES.PAID
      && safeString(paymentsMode, 'disabled').toLowerCase() === 'telegram_stars',
  );
}

function checkout(status, patch = {}) {
  return {
    status: VALID_CHECKOUT_STATES.has(status) ? status : CHECKOUT_STATES.IDLE,
    error: null,
    restored: false,
    ...patch,
  };
}

/**
 * Pure lifecycle reducer for the future payment adapter.  A UI callback may
 * dispatch SUCCESS only after the server/Telegram adapter confirms it; no
 * client callback is interpreted here as proof of entitlement.
 */
export function reduceCheckoutState(state = checkout(CHECKOUT_STATES.IDLE), event = {}) {
  const current = state && typeof state === 'object' ? state : checkout(CHECKOUT_STATES.IDLE);
  const type = safeString(event.type).toUpperCase();
  switch (type) {
    case 'BEGIN':
      return checkout(CHECKOUT_STATES.PENDING, { requestId: event.requestId || null });
    case 'SUCCESS':
      return checkout(CHECKOUT_STATES.SUCCESS, {
        requestId: event.requestId || current.requestId || null,
        operationId: event.operationId || null,
      });
    case 'CANCEL':
    case 'CANCELLED':
      return checkout(CHECKOUT_STATES.CANCELLED, {
        requestId: current.requestId || null,
        reason: safeString(event.reason),
      });
    case 'FAIL':
    case 'ERROR':
      return checkout(CHECKOUT_STATES.ERROR, {
        requestId: current.requestId || null,
        error: safeString(event.error, 'Не удалось подтвердить покупку'),
      });
    case 'RETRY':
      return checkout(CHECKOUT_STATES.PENDING, { requestId: event.requestId || current.requestId || null });
    case 'RESTORE':
      return checkout(CHECKOUT_STATES.RESTORING, { requestId: event.requestId || null });
    case 'RESTORE_SUCCESS':
      return checkout(CHECKOUT_STATES.SUCCESS, {
        restored: true,
        requestId: current.requestId || null,
        operationId: event.operationId || null,
      });
    case 'RESTORE_EMPTY':
      return checkout(CHECKOUT_STATES.CANCELLED, {
        restored: false,
        requestId: current.requestId || null,
        reason: 'Покупок для восстановления не найдено',
      });
    case 'RESET':
      return checkout(CHECKOUT_STATES.IDLE);
    default:
      return current;
  }
}

export function isCheckoutTerminal(state) {
  return state?.status === CHECKOUT_STATES.SUCCESS
    || state?.status === CHECKOUT_STATES.CANCELLED
    || state?.status === CHECKOUT_STATES.ERROR;
}

export function isKnownPackState(state) {
  return VALID_PACK_STATES.has(state);
}
