import { createPublicKey, createVerify } from 'node:crypto';

const CLOCK_SKEW_SECONDS = 60;
let jwksCache = new Map();

async function fetchJwks(uri, force = false) {
  const cached = jwksCache.get(uri);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.keys;
  const response = await fetch(uri, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Telegram OIDC JWKS request failed (${response.status})`);
  const body = await response.json();
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(uri, { keys, expiresAt: Date.now() + 5 * 60_000 });
  return keys;
}

function decodeJwtPart(part) {
  try { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); } catch { return null; }
}

function parseJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed Telegram OIDC id_token');
  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]);
  const signature = Buffer.from(parts[2], 'base64url');
  if (!header || !claims || !signature.length) throw new Error('Malformed Telegram OIDC id_token');
  return { header, claims, signature, signingInput: `${parts[0]}.${parts[1]}` };
}

async function verifySignature(parsed, jwksUrl) {
  if (parsed.header.alg !== 'RS256' || !parsed.header.kid) throw new Error('Unsupported Telegram OIDC signature');
  let keys = await fetchJwks(jwksUrl);
  let jwk = keys.find((key) => key.kid === parsed.header.kid && key.kty === 'RSA');
  if (!jwk) {
    keys = await fetchJwks(jwksUrl, true);
    jwk = keys.find((key) => key.kid === parsed.header.kid && key.kty === 'RSA');
  }
  if (!jwk) throw new Error('Telegram OIDC signing key not found');
  let publicKey;
  try { publicKey = createPublicKey({ key: jwk, format: 'jwk' }); } catch { throw new Error('Invalid Telegram OIDC signing key'); }
  const verifier = createVerify('RSA-SHA256');
  verifier.update(parsed.signingInput);
  verifier.end();
  if (!verifier.verify(publicKey, parsed.signature)) throw new Error('Invalid Telegram OIDC signature');
}

export async function verifyTelegramIdToken(idToken, { issuer, audience, jwksUrl, nonce, now = Date.now() } = {}) {
  const parsed = parseJwt(idToken);
  if (parsed.header.typ && parsed.header.typ !== 'JWT') throw new Error('Invalid Telegram OIDC token type');
  await verifySignature(parsed, jwksUrl);
  const claims = parsed.claims;
  if (claims.iss !== issuer) throw new Error('Invalid Telegram OIDC issuer');
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(audience)) throw new Error('Invalid Telegram OIDC audience');
  const nowSeconds = Math.floor(now / 1_000);
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= nowSeconds - CLOCK_SKEW_SECONDS) throw new Error('Expired Telegram OIDC token');
  if (!Number.isFinite(Number(claims.iat)) || Number(claims.iat) > nowSeconds + CLOCK_SKEW_SECONDS) throw new Error('Invalid Telegram OIDC issued-at claim');
  if (!claims.sub || typeof claims.sub !== 'string') throw new Error('Telegram OIDC subject is missing');
  if (nonce && claims.nonce !== nonce) throw new Error('Invalid Telegram OIDC nonce');
  // Telegram's signed profile id is the canonical numeric account key. Do
  // not fall back to sub: the subject is an OIDC identifier, not the Mini App
  // initData user identifier used by the existing account table.
  const telegramId = String(claims.id ?? '').trim();
  if (!/^\d+$/.test(telegramId)) throw new Error('Telegram OIDC profile id is missing');
  return { ...claims, id: telegramId };
}

export function resetOidcJwksCacheForTests() {
  jwksCache = new Map();
}
