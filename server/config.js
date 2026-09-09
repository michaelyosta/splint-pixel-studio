import { isIP } from 'node:net';

export const TELEGRAM_STARS_CONTROLLED_MODE = 'telegram_stars_controlled';

export const PAYMENT_MODES = Object.freeze([
  'disabled',
  'internal_credits',
  'telegram_stars',
  TELEGRAM_STARS_CONTROLLED_MODE,
]);

const TELEGRAM_USER_ID_RE = /^\d{1,30}$/;
const PRINTABLE_TOKEN_RE = /^[\x21-\x7E]+$/;

function parseCsv(raw, name) {
  const values = String(raw || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!values.length) throw new Error(`${name} is required for controlled Telegram Stars`);
  return [...new Set(values)];
}

function parseTelegramStarsAllowlist(raw) {
  const values = parseCsv(raw, 'TELEGRAM_STARS_ALLOWLIST_USER_IDS');
  for (const value of values) {
    if (!TELEGRAM_USER_ID_RE.test(value)) {
      throw new Error(`TELEGRAM_STARS_ALLOWLIST_USER_IDS contains an invalid Telegram user id: ${value}`);
    }
  }
  return values;
}

function parseProductAllowlist(raw) {
  const values = parseCsv(raw, 'TELEGRAM_STARS_ALLOWLIST_PRODUCT_IDS');
  for (const value of values) {
    if (value.length > 200 || !PRINTABLE_TOKEN_RE.test(value)) {
      throw new Error(`TELEGRAM_STARS_ALLOWLIST_PRODUCT_IDS contains an invalid product id: ${value}`);
    }
  }
  return values;
}

function parseWebhookUrl(raw) {
  const value = String(raw || '').trim();
  let url;
  try { url = new URL(value); } catch { throw new Error('TELEGRAM_PAYMENTS_WEBHOOK_URL must be an HTTPS URL for controlled Telegram Stars'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('TELEGRAM_PAYMENTS_WEBHOOK_URL must be an HTTPS URL without credentials, query, or hash');
  }
  return value;
}

function parseWebhookSecret(raw) {
  const value = String(raw || '').trim();
  if (value.length < 1 || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('TELEGRAM_PAYMENTS_WEBHOOK_SECRET must be 1-256 letters, numbers, underscores, or hyphens');
  }
  return value;
}

function requiredContact(raw, name) {
  const value = String(raw || '').trim();
  if (!value || value.length > 500 || !PRINTABLE_TOKEN_RE.test(value)) throw new Error(`${name} is required for controlled Telegram Stars`);
  return value;
}

export function getTelegramStarsControlledConfiguration(env = process.env) {
  if (getPaymentsMode(env) !== TELEGRAM_STARS_CONTROLLED_MODE) {
    return Object.freeze({ enabled: false, allowlistedUserIds: Object.freeze([]), allowlistedProductIds: Object.freeze([]) });
  }
  return Object.freeze({
    enabled: true,
    allowlistedUserIds: Object.freeze(parseTelegramStarsAllowlist(env.TELEGRAM_STARS_ALLOWLIST_USER_IDS)),
    allowlistedProductIds: Object.freeze(parseProductAllowlist(env.TELEGRAM_STARS_ALLOWLIST_PRODUCT_IDS)),
    webhookUrl: parseWebhookUrl(env.TELEGRAM_PAYMENTS_WEBHOOK_URL),
    webhookSecret: parseWebhookSecret(env.TELEGRAM_PAYMENTS_WEBHOOK_SECRET),
    supportContact: requiredContact(env.TELEGRAM_PAYMENT_SUPPORT, 'TELEGRAM_PAYMENT_SUPPORT'),
    refundContact: requiredContact(env.TELEGRAM_PAYMENT_REFUND_CONTACT, 'TELEGRAM_PAYMENT_REFUND_CONTACT'),
  });
}

// An omitted NODE_ENV is kept compatible with the existing local test
// harnesses. Explicitly named staging/preview environments must never inherit
// the local X-User-Id/debug surface just because a deployment accidentally
// carried ALLOW_DEV_AUTH=true.
export function isLocalDevelopmentEnvironment(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  return !nodeEnv || nodeEnv === 'development' || nodeEnv === 'test';
}

export function isDevelopmentAuthEnabled(env = process.env) {
  return env.ALLOW_DEV_AUTH === 'true' && isLocalDevelopmentEnvironment(env);
}

export function getPaymentsMode(env = process.env) {
  const defaultMode = isLocalDevelopmentEnvironment(env) ? 'internal_credits' : 'disabled';
  const mode = String(env.PAYMENTS_MODE || defaultMode).trim().toLowerCase();
  if (!PAYMENT_MODES.includes(mode)) {
    throw new Error(`PAYMENTS_MODE must be one of: ${PAYMENT_MODES.join('|')}`);
  }
  return mode;
}

function parseOrigins(raw) {
  const origins = String(raw || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!origins.length) throw new Error('CORS_ORIGINS is required in production');
  for (const origin of origins) {
    let url;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(`Invalid CORS origin: ${origin}`);
    }
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) {
      throw new Error(`CORS origin must be an exact HTTPS origin without credentials or path: ${origin}`);
    }
  }
  return origins;
}

function parseProxyAddress(value) {
  const [address, prefix] = value.split('/');
  const version = isIP(address);
  if (!version) throw new Error(`Invalid TRUST_PROXY address: ${value}`);
  if (prefix !== undefined) {
    const bits = Number(prefix);
    const max = version === 4 ? 32 : 128;
    if (!Number.isInteger(bits) || bits < 0 || bits > max) {
      throw new Error(`Invalid TRUST_PROXY prefix: ${value}`);
    }
  }
  return value;
}

function validateProductionS3Endpoint(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new Error('S3_ENDPOINT must be a valid HTTPS URL in production');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('S3_ENDPOINT must be an HTTPS URL without embedded credentials in production');
  }
  return url.href;
}

export function validateProductionConfiguration(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv !== 'production') {
    return { isProduction: false, allowedOrigins: [], trustProxy: false };
  }

  const paymentsMode = getPaymentsMode(env);

  if (env.ALLOW_DEV_AUTH === 'true') throw new Error('ALLOW_DEV_AUTH cannot be enabled in production');
  if (env.SPECIAL_CELLS_QA_OVERRIDE === 'true') throw new Error('SPECIAL_CELLS_QA_OVERRIDE cannot be enabled in production');
  if (env.SPECIAL_CELLS_DIAGNOSTICS === 'true') throw new Error('SPECIAL_CELLS_DIAGNOSTICS cannot be enabled in production');
  if (env.SPECIAL_CELLS_LEGACY_CHOICE_FIXTURE === 'true') throw new Error('SPECIAL_CELLS_LEGACY_CHOICE_FIXTURE cannot be enabled in production');
  if (env.E2E_SEED_HOOKS === 'true') throw new Error('E2E_SEED_HOOKS cannot be enabled in production');
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is required in production');
  if (env.SEED_DEMO_DATA === 'true') throw new Error('SEED_DEMO_DATA cannot be enabled in production');

  if (paymentsMode === 'internal_credits') {
    throw new Error('PAYMENTS_MODE=internal_credits cannot be enabled in production; keep production payments disabled');
  }

  if (paymentsMode === 'telegram_stars') {
    // The provider adapter/webhook is intentionally not mounted in this
    // bounded slice. Refuse a production boot that could advertise an active
    // Stars mode until a separate release wires the real Bot API path.
    throw new Error('PAYMENTS_MODE=telegram_stars is not available in this release; keep production payments disabled');
  }

  if (paymentsMode === TELEGRAM_STARS_CONTROLLED_MODE) {
    // Controlled activation is deliberately explicit. A production process
    // must not boot with a mode that can create invoices but lacks a complete
    // allowlist, webhook authentication, or support/refund contact.
    getTelegramStarsControlledConfiguration(env);
  }

  const required = ['DATABASE_URL', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  const missing = required.filter((name) => !String(env[name] || '').trim());
  if (env.STORAGE_DRIVER !== 's3') missing.push('STORAGE_DRIVER=s3');
  if (missing.length) throw new Error(`Missing required production configuration: ${missing.join(', ')}`);
  validateProductionS3Endpoint(env.S3_ENDPOINT);

  const allowedOrigins = parseOrigins(env.CORS_ORIGINS);
  const trustProxyValues = String(env.TRUST_PROXY || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!trustProxyValues.length) throw new Error('TRUST_PROXY is required in production');
  if (trustProxyValues.some((value) => /^\d+$/.test(value))) {
    throw new Error('TRUST_PROXY must list explicit proxy IPs or CIDRs, not a hop count');
  }

  return {
    isProduction: true,
    allowedOrigins,
    trustProxy: trustProxyValues.map(parseProxyAddress),
    paymentsMode,
    telegramStars: paymentsMode === TELEGRAM_STARS_CONTROLLED_MODE
      ? getTelegramStarsControlledConfiguration(env)
      : null,
  };
}
