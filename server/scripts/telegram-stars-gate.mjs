import { closeDb, get, getDb, initDb, withDbTransaction } from '../db.js';
import { validateProductionConfiguration } from '../config.js';
import { createTelegramStarsPurchaseGate, TELEGRAM_STARS_GATE_MODES } from '../services/telegram-stars-purchase-gate.js';

const [command, requestedMode, ...args] = process.argv.slice(2);
const reasonArg = args.find((value) => value.startsWith('--reason='));
const actorArg = args.find((value) => value.startsWith('--actor='));
const confirmed = args.includes('--confirm-public=TELEGRAM_STARS_PUBLIC');

if (!['status', 'set'].includes(command) || command === 'set' && !TELEGRAM_STARS_GATE_MODES.includes(requestedMode)) {
  console.error('Usage: node scripts/telegram-stars-gate.mjs status');
  console.error('   or: node scripts/telegram-stars-gate.mjs set disabled|controlled --reason=<reason> [--actor=<actor>]');
  console.error('   or: node scripts/telegram-stars-gate.mjs set public --reason=<reason> --confirm-public=TELEGRAM_STARS_PUBLIC [--actor=<actor>]');
  process.exitCode = 2;
} else if (requestedMode === 'public' && !confirmed) {
  console.error('Public mode requires --confirm-public=TELEGRAM_STARS_PUBLIC');
  process.exitCode = 2;
} else if (requestedMode === 'public' && process.env.TELEGRAM_STARS_RECONCILIATION_ENABLED === 'false') {
  console.error('Public mode requires the Telegram Stars reconciliation worker');
  process.exitCode = 2;
} else {
  try {
    const config = validateProductionConfiguration(process.env);
    if (!config.telegramStars) throw new Error('The provider runtime must remain telegram_stars_controlled');
    await initDb();
    const gate = createTelegramStarsPurchaseGate({
      dbGet: get,
      withTransaction: withDbTransaction,
      dbMode: getDb().mode,
      allowlistedUserIds: config.telegramStars.allowlistedUserIds,
      allowlistedProductIds: config.telegramStars.allowlistedProductIds,
    });
    const current = await gate.getState();
    if (command === 'status') {
      console.log(JSON.stringify(current));
    } else {
      if (requestedMode === 'public') {
        const product = await get(
          `SELECT id,pack_type,price_in_stars,status,visibility,owner_id
             FROM collections WHERE id=?`,
          ['col_premium-gallery'],
        );
        if (config.telegramStars.allowlistedProductIds.length !== 1
          || config.telegramStars.allowlistedProductIds[0] !== 'col_premium-gallery'
          || !product || product.pack_type !== 'premium' || Number(product.price_in_stars) !== 120
          || product.status !== 'published' || product.visibility !== 'public' || product.owner_id !== null) {
          throw new Error('Public Stars activation requires the single approved product col_premium-gallery at 120 Stars');
        }
      }
      const reason = reasonArg?.slice('--reason='.length);
      const actor = actorArg?.slice('--actor='.length) || 'render-shell-operator';
      const next = await gate.setState({ mode: requestedMode, expectedVersion: current.version, reason, actor });
      console.log(JSON.stringify(next));
    }
  } finally {
    await closeDb();
  }
}
