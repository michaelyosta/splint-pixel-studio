import { createHash, randomBytes } from 'node:crypto';

export function createPkceVerifier() {
  return randomBytes(32).toString('base64url');
}

export function createPkceChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}
