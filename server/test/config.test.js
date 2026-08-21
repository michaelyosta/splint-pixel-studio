import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProductionConfiguration } from '../config.js';

const validProduction = {
  NODE_ENV: 'production',
  ALLOW_DEV_AUTH: 'false',
  SEED_DEMO_DATA: 'false',
  TELEGRAM_BOT_TOKEN: 'token',
  DATABASE_URL: 'postgresql://db/splint',
  STORAGE_DRIVER: 's3',
  S3_ENDPOINT: 'https://s3.example.com',
  S3_BUCKET: 'splint',
  S3_ACCESS_KEY_ID: 'access',
  S3_SECRET_ACCESS_KEY: 'secret',
  CORS_ORIGINS: 'https://app.example.com,https://admin.example.com',
  TRUST_PROXY: '10.0.0.0/8,192.168.10.4',
};

test('development permits SQLite and local storage', () => {
  assert.deepStrictEqual(
    validateProductionConfiguration({ NODE_ENV: 'development' }),
    { isProduction: false, allowedOrigins: [], trustProxy: false },
  );
});

test('complete production configuration is accepted', () => {
  const result = validateProductionConfiguration(validProduction);
  assert.equal(result.isProduction, true);
  assert.equal(result.paymentsMode, 'disabled');
  assert.deepStrictEqual(result.allowedOrigins, ['https://app.example.com', 'https://admin.example.com']);
  assert.deepStrictEqual(result.trustProxy, ['10.0.0.0/8', '192.168.10.4']);
});

test('production Telegram Stars mode remains fail-closed until a release wires the provider', () => {
  const env = { ...validProduction, PAYMENTS_MODE: 'telegram_stars' };
  assert.throws(() => validateProductionConfiguration(env), /not available in this release/);
});

test('invalid payment mode is rejected', () => {
  assert.throws(
    () => validateProductionConfiguration({ ...validProduction, PAYMENTS_MODE: 'real_money' }),
    /PAYMENTS_MODE must be one of/,
  );
});

test('production rejects QA diagnostics and cohort override flags', () => {
  assert.throws(
    () => validateProductionConfiguration({ ...validProduction, SPECIAL_CELLS_QA_OVERRIDE: 'true' }),
    /SPECIAL_CELLS_QA_OVERRIDE cannot be enabled in production/,
  );
  assert.throws(
    () => validateProductionConfiguration({ ...validProduction, SPECIAL_CELLS_DIAGNOSTICS: 'true' }),
    /SPECIAL_CELLS_DIAGNOSTICS cannot be enabled in production/,
  );
});

for (const [name, mutate, expected] of [
  ['DATABASE_URL', (env) => { delete env.DATABASE_URL; }, /DATABASE_URL/],
  ['S3 config', (env) => { delete env.S3_BUCKET; }, /S3_BUCKET/],
  ['S3 driver', (env) => { env.STORAGE_DRIVER = 'local'; }, /STORAGE_DRIVER=s3/],
  ['CORS origins', (env) => { delete env.CORS_ORIGINS; }, /CORS_ORIGINS/],
  ['HTTPS CORS origin', (env) => { env.CORS_ORIGINS = 'http://app.example.com'; }, /exact HTTPS origin/],
  ['CORS path', (env) => { env.CORS_ORIGINS = 'https://app.example.com/path'; }, /without credentials or path/],
  ['trust proxy hop count', (env) => { env.TRUST_PROXY = '1'; }, /not a hop count/],
  ['trust proxy address', (env) => { env.TRUST_PROXY = 'not-a-proxy'; }, /Invalid TRUST_PROXY/],
]) {
  test(`production rejects missing or invalid ${name}`, () => {
    const env = { ...validProduction };
    mutate(env);
    assert.throws(() => validateProductionConfiguration(env), expected);
  });
}
