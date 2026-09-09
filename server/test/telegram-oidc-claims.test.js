import test from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { createPkceChallenge } from '../services/pkce.js';
import { resetOidcJwksCacheForTests, verifyTelegramIdToken } from '../services/telegram-oidc-claims.js';

const ISSUER = 'https://oauth.telegram.org';
const AUDIENCE = '123456789';
const NONCE = 'nonce-for-test';

function signJwt(privateKey, claims, header = { alg: 'RS256', typ: 'JWT', kid: 'test-key' }) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const encodedHeader = encode(header);
  const encodedClaims = encode(claims);
  const input = `${encodedHeader}.${encodedClaims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  signer.end();
  return `${input}.${signer.sign(privateKey).toString('base64url')}`;
}

function baseClaims(now = Math.floor(Date.now() / 1_000)) {
  return { iss: ISSUER, aud: AUDIENCE, sub: 'oidc-subject', iat: now - 5, exp: now + 600, nonce: NONCE, id: '777001' };
}

function corruptSignature(token) {
  const parts = token.split('.');
  const signature = Buffer.from(parts[2], 'base64url');
  signature[0] ^= 0xff;
  return `${parts[0]}.${parts[1]}.${signature.toString('base64url')}`;
}

test('PKCE challenge uses the RFC 7636 S256 transform', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(createPkceChallenge(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('OIDC id_token verifies signature and security claims', async (t) => {
  resetOidcJwksCacheForTests();
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const jwksServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  t.after(() => jwksServer.close());
  const jwksUrl = `http://127.0.0.1:${jwksServer.address().port}/jwks.json`;
  const token = signJwt(privateKey, baseClaims());

  const verified = await verifyTelegramIdToken(token, { issuer: ISSUER, audience: AUDIENCE, jwksUrl, nonce: NONCE });
  assert.equal(verified.id, '777001');
  assert.equal(verified.sub, 'oidc-subject');

  const cases = [
    ['invalid signature', corruptSignature(token), /signature/],
    ['invalid issuer', signJwt(privateKey, { ...baseClaims(), iss: 'https://attacker.example' }), /issuer/],
    ['invalid audience', signJwt(privateKey, { ...baseClaims(), aud: 'wrong-client' }), /audience/],
    ['expired token', signJwt(privateKey, { ...baseClaims(), exp: Math.floor(Date.now() / 1_000) - 120 }), /Expired/],
    ['missing canonical id', signJwt(privateKey, { ...baseClaims(), id: undefined }), /profile id/],
    ['invalid nonce', signJwt(privateKey, { ...baseClaims(), nonce: 'wrong' }), /nonce/],
  ];
  for (const [name, invalidToken, message] of cases) {
    await assert.rejects(
      () => verifyTelegramIdToken(invalidToken, { issuer: ISSUER, audience: AUDIENCE, jwksUrl, nonce: NONCE }),
      message,
      name,
    );
  }
});
