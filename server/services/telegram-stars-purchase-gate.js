import { v4 as uuid } from 'uuid';

export const TELEGRAM_STARS_GATE_MODES = Object.freeze(['disabled', 'controlled', 'public']);

function normalizeId(value) {
  const id = String(value ?? '').trim().replace(/^tg_/, '');
  return /^\d{1,30}$/.test(id) ? id : null;
}

function requireText(value, name, max = 500) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(`${name} is required and must not exceed ${max} characters`);
  return text;
}

export function createTelegramStarsPurchaseGate({
  dbGet,
  withTransaction,
  dbMode = 'sqlite',
  allowlistedUserIds = [],
  allowlistedProductIds = [],
  clock = () => new Date(),
  idFactory = uuid,
} = {}) {
  if (typeof dbGet !== 'function' || typeof withTransaction !== 'function') throw new TypeError('dbGet and withTransaction are required');
  const users = new Set(allowlistedUserIds.map(String));
  const products = new Set(allowlistedProductIds.map(String));
  const lock = dbMode === 'postgres' ? ' FOR UPDATE' : '';

  async function getState() {
    try {
      const row = await dbGet("SELECT mode,version,reason,actor,updated_at FROM telegram_stars_purchase_gate WHERE id='global'");
      if (!row || !TELEGRAM_STARS_GATE_MODES.includes(row.mode)) return { mode: 'disabled', version: 0, failClosed: true };
      return { ...row, version: Number(row.version), failClosed: false };
    } catch {
      return { mode: 'disabled', version: 0, failClosed: true };
    }
  }

  async function getAccess({ telegramUserId, productId }) {
    const state = await getState();
    const userId = normalizeId(telegramUserId);
    const productAllowed = products.has(String(productId ?? '').trim());
    const userAllowed = Boolean(userId && users.has(userId));
    return {
      ...state,
      allowed: productAllowed && Boolean(userId) && (state.mode === 'public' || state.mode === 'controlled' && userAllowed),
      productAllowed,
      userAllowed,
      clientMode: state.mode === 'public' ? 'telegram_stars' : state.mode === 'controlled' && userAllowed ? 'telegram_stars_controlled' : 'disabled',
    };
  }

  async function setState({ mode, expectedVersion, reason, actor = 'operator' }) {
    if (!TELEGRAM_STARS_GATE_MODES.includes(mode)) throw new Error('Invalid Telegram Stars gate mode');
    const cleanReason = requireText(reason, 'reason');
    const cleanActor = requireText(actor, 'actor', 100);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error('expectedVersion must be a positive integer');
    return withTransaction(async tx => {
      const current = await tx.get(`SELECT * FROM telegram_stars_purchase_gate WHERE id='global'${lock}`);
      if (!current || Number(current.version) !== expectedVersion) throw new Error('TELEGRAM_STARS_GATE_VERSION_CONFLICT');
      const nextVersion = expectedVersion + 1;
      const now = new Date(clock()).toISOString();
      const updated = await tx.run(
        "UPDATE telegram_stars_purchase_gate SET mode=?,version=?,reason=?,actor=?,updated_at=? WHERE id='global' AND version=?",
        [mode, nextVersion, cleanReason, cleanActor, now, expectedVersion],
      );
      if (updated.changes !== 1) throw new Error('TELEGRAM_STARS_GATE_VERSION_CONFLICT');
      await tx.run(
        'INSERT INTO telegram_stars_purchase_gate_audit (id,previous_mode,next_mode,version,reason,actor,changed_at) VALUES (?,?,?,?,?,?,?)',
        [`xtr_gate_${idFactory()}`, current.mode, mode, nextVersion, cleanReason, cleanActor, now],
      );
      return { mode, version: nextVersion, reason: cleanReason, actor: cleanActor, updated_at: now, failClosed: false };
    });
  }

  async function stop(reason = 'automatic_payment_safety_stop') {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = await getState();
      if (state.mode === 'disabled') return state;
      try { return await setState({ mode: 'disabled', expectedVersion: state.version, reason, actor: 'automatic-safety-latch' }); } catch (error) {
        if (error.message !== 'TELEGRAM_STARS_GATE_VERSION_CONFLICT') throw error;
      }
    }
    throw new Error('TELEGRAM_STARS_GATE_STOP_CONFLICT');
  }

  return Object.freeze({ getState, getAccess, setState, stop });
}
