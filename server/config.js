import { isIP } from 'node:net';

export const PAYMENT_MODES = Object.freeze(['disabled', 'internal_credits', 'telegram_stars']);

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
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is required in production');
  if (env.SEED_DEMO_DATA === 'true') throw new Error('SEED_DEMO_DATA cannot be enabled in production');

  if (paymentsMode === 'telegram_stars') {
    const paymentRequired = [
      'TELEGRAM_PAYMENTS_WEBHOOK_SECRET',
      'TELEGRAM_PAYMENT_SUPPORT',
      'TELEGRAM_PAYMENT_REFUND_CONTACT',
    ];
    const missingPayments = paymentRequired.filter((name) => !String(env[name] || '').trim());
    if (missingPayments.length) {
      throw new Error(`PAYMENTS_MODE=telegram_stars requires: ${missingPayments.join(', ')}`);
    }
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
