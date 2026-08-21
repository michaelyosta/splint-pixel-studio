import { isIP } from 'node:net';

export const PAYMENT_MODES = Object.freeze(['disabled', 'internal_credits', 'telegram_stars']);

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
  const defaultMode = env.NODE_ENV === 'production' ? 'disabled' : 'internal_credits';
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

export function validateProductionConfiguration(env = process.env) {
  if (env.NODE_ENV !== 'production') {
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

  const required = ['DATABASE_URL', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  const missing = required.filter((name) => !String(env[name] || '').trim());
  if (env.STORAGE_DRIVER !== 's3') missing.push('STORAGE_DRIVER=s3');
  if (missing.length) throw new Error(`Missing required production configuration: ${missing.join(', ')}`);

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
  };
}
