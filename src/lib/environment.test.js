import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('.env.example does not pin NODE_ENV for production builds', async () => {
  const source = await readFile(new URL('../../.env.example', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*NODE_ENV\s*=/m);
});
