// Public operations probe for Splint: minimal live frontend/API readiness.
// Stdlib only (global fetch/AbortController). One attempt per endpoint, no
// retries. Never sends credentials and never logs response bodies.
//
// Usage:
//   node scripts/ops-probe.mjs [--json]
// Probes the locked production origins below. Deterministic failure and
// recovery drills live in test/ops-probe.test.js against localhost stubs.

export const PROD_FRONTEND_ORIGIN = 'https://pixel.showalove.ru';
export const PROD_API_ORIGIN = 'https://splint-api.onrender.com';

// Official Telegram WebApp SDK. Listed here so the asset census can tell it
// apart from unexpected foreign scripts. Allowlisted URLs are never fetched.
export const EXTERNAL_SCRIPT_ALLOWLIST = Object.freeze([
  'https://telegram.org/js/telegram-web-app.js',
]);

const ROOT_MARKER = '<div id="root"';
const TITLE_MARKER = '<title>Splint Pixel Studio';

export const DEFAULT_LIMITS = Object.freeze({
  timeoutMs: 75000,
  maxHtmlBytes: 1024 * 1024,
  maxAssetBytes: 16 * 1024 * 1024,
  maxJsonBytes: 256 * 1024,
  maxAssets: 25,
});

function normalizeOrigin(origin) {
  return String(origin || '').replace(/\/+$/, '');
}

function checkResult(name, ok, detail, durationMs) {
  return { name, ok: Boolean(ok), detail: String(detail || ''), durationMs };
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeout = new Error(`timeout after ${timeoutMs}ms: ${url}`);
      timeout.code = 'PROBE_TIMEOUT';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(response, maxBytes, label) {
  if (!response.body) return { bytes: 0, text: '', tooLarge: false };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* reader already closed */ }
      const oversize = new Error(`${label} exceeds ${maxBytes} bytes`);
      oversize.code = 'PROBE_TOO_LARGE';
      throw oversize;
    }
    chunks.push(value);
  }
  const merged = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return { bytes: total, text: merged.toString('utf8'), tooLarge: false };
}

function extractAssetRefs(html, baseOrigin) {
  const refs = [];
  const scriptPattern = /<script[^>]+src=["']([^"']+)["']/gi;
  const cssPattern = /<link[^>]+href=["']([^"']+\.css[^"']*)["']/gi;
  let match = null;
  while ((match = scriptPattern.exec(html)) !== null) refs.push({ url: match[1], kind: 'script' });
  while ((match = cssPattern.exec(html)) !== null) refs.push({ url: match[1], kind: 'stylesheet' });
  const seen = new Set();
  const out = [];
  for (const ref of refs) {
    let absolute = null;
    try {
      absolute = new URL(ref.url, `${baseOrigin}/`).toString();
    } catch {
      continue;
    }
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    out.push({ ...ref, absolute });
  }
  return out;
}

function isSameOrigin(absoluteUrl, baseOrigin) {
  try {
    return new URL(absoluteUrl).origin === new URL(baseOrigin).origin;
  } catch {
    return false;
  }
}

export async function probeOperations({
  frontendOrigin = PROD_FRONTEND_ORIGIN,
  apiOrigin = PROD_API_ORIGIN,
  expectedApiOrigin = PROD_API_ORIGIN,
  timeoutMs = DEFAULT_LIMITS.timeoutMs,
  limits = DEFAULT_LIMITS,
  fetchImpl = globalThis.fetch,
} = {}) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const frontend = normalizeOrigin(frontendOrigin);
  const api = normalizeOrigin(apiOrigin);
  const checks = [];
  const fail = (name, detail, durationMs) => checks.push(checkResult(name, false, detail, durationMs));

  const timed = async (name, fn) => {
    const begin = Date.now();
    try {
      const detail = await fn();
      checks.push(checkResult(name, true, detail, Date.now() - begin));
      return true;
    } catch (error) {
      checks.push(checkResult(name, false, `${error?.code || 'PROBE_ERROR'}: ${error?.message || error}`, Date.now() - begin));
      return false;
    }
  };

  let homeText = '';
  let assetRefs = [];
  const homeOk = await timed('frontend-home', async () => {
    const response = await fetchWithTimeout(fetchImpl, `${frontend}/`, timeoutMs);
    if (response.status !== 200) throw Object.assign(new Error(`http-${response.status}`), { code: 'PROBE_HTTP' });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) throw Object.assign(new Error(`unexpected content-type ${contentType}`), { code: 'PROBE_SCHEMA' });
    const body = await readCapped(response, limits.maxHtmlBytes, 'homepage');
    homeText = body.text;
    if (!homeText.includes(ROOT_MARKER)) throw Object.assign(new Error('missing root marker'), { code: 'PROBE_SCHEMA' });
    if (!homeText.includes(TITLE_MARKER)) throw Object.assign(new Error('missing title marker'), { code: 'PROBE_SCHEMA' });
    assetRefs = extractAssetRefs(homeText, frontend);
    return `http-200 html-${body.bytes}b refs-${assetRefs.length}`;
  });

  let sameOriginJs = [];
  if (homeOk) {
    const foreign = assetRefs.filter((ref) => !isSameOrigin(ref.absolute, frontend));
    const unexpected = foreign.filter((ref) => !EXTERNAL_SCRIPT_ALLOWLIST.includes(ref.absolute));
    const skippedAllowed = foreign.length - unexpected.length;
    if (unexpected.length > 0) {
      fail('frontend-assets', `unexpected foreign assets: ${unexpected.slice(0, 3).map((ref) => ref.absolute).join(', ')}`, 0);
    } else {
      const local = assetRefs.filter((ref) => isSameOrigin(ref.absolute, frontend));
      if (local.length > limits.maxAssets) {
        fail('frontend-assets', `too many assets: ${local.length} > ${limits.maxAssets}`, 0);
      } else if (!local.some((ref) => ref.kind === 'script')) {
        fail('frontend-assets', 'no same-origin script entry', 0);
      } else {
        await timed('frontend-assets', async () => {
          const fetched = await Promise.all(local.map(async (ref) => {
            const response = await fetchWithTimeout(fetchImpl, ref.absolute, timeoutMs);
            if (response.status !== 200) throw Object.assign(new Error(`http-${response.status} ${ref.absolute}`), { code: 'PROBE_HTTP' });
            if (ref.kind !== 'script') {
              await readCapped(response, limits.maxJsonBytes, `asset ${ref.absolute}`);
              return { ref, text: '' };
            }
            const body = await readCapped(response, limits.maxAssetBytes, `asset ${ref.absolute}`);
            return { ref, text: body.text, bytes: body.bytes };
          }));
          sameOriginJs = fetched.filter((entry) => entry.ref.kind === 'script');
          const total = fetched.length;
          return `fetched-${total} skipped-foreign-${skippedAllowed}`;
        });
      }
    }
  }

  await timed('api-binding', async () => {
    const expected = normalizeOrigin(expectedApiOrigin);
    const hit = sameOriginJs.some((entry) => entry.text.includes(expected));
    if (!hit) throw Object.assign(new Error(`expected API origin absent from ${sameOriginJs.length} same-origin scripts`), { code: 'PROBE_BINDING' });
    return `api-origin present in bundle`;
  });

  await timed('api-live', async () => {
    const response = await fetchWithTimeout(fetchImpl, `${api}/live`, timeoutMs);
    if (response.status !== 200) throw Object.assign(new Error(`http-${response.status}`), { code: 'PROBE_HTTP' });
    const body = await readCapped(response, limits.maxJsonBytes, 'live');
    let payload = null;
    try { payload = JSON.parse(body.text); } catch { throw Object.assign(new Error('invalid json'), { code: 'PROBE_SCHEMA' }); }
    if (payload?.status !== 'alive') throw Object.assign(new Error('unexpected live payload'), { code: 'PROBE_SCHEMA' });
    return 'alive';
  });

  await timed('api-health', async () => {
    const response = await fetchWithTimeout(fetchImpl, `${api}/health`, timeoutMs);
    if (response.status !== 200) throw Object.assign(new Error(`http-${response.status}`), { code: 'PROBE_HTTP' });
    const body = await readCapped(response, limits.maxJsonBytes, 'health');
    let payload = null;
    try { payload = JSON.parse(body.text); } catch { throw Object.assign(new Error('invalid json'), { code: 'PROBE_SCHEMA' }); }
    if (payload?.status !== 'ok') throw Object.assign(new Error('unexpected health payload'), { code: 'PROBE_SCHEMA' });
    const timestamp = Date.parse(payload.timestamp);
    if (!Number.isFinite(timestamp)) throw Object.assign(new Error('invalid health timestamp'), { code: 'PROBE_SCHEMA' });
    if (Math.abs(Date.now() - timestamp) > 10 * 60 * 1000) throw Object.assign(new Error('stale health timestamp'), { code: 'PROBE_SCHEMA' });
    return 'ok';
  });

  await timed('api-ready', async () => {
    const response = await fetchWithTimeout(fetchImpl, `${api}/ready`, timeoutMs);
    const body = await readCapped(response, limits.maxJsonBytes, 'ready');
    let payload = null;
    try { payload = JSON.parse(body.text); } catch { throw Object.assign(new Error(`http-${response.status} invalid json`), { code: 'PROBE_SCHEMA' }); }
    if (response.status !== 200 || payload?.ready !== true) {
      throw Object.assign(new Error(`unready http-${response.status} ready-${payload?.ready}`), { code: 'PROBE_UNREADY' });
    }
    const checks = payload.checks || {};
    for (const name of ['database', 'object_storage', 'configuration']) {
      // Strict production gate: only literal `ok` passes. The server also
      // treats `development` as ready, which must never satisfy production
      // monitoring because it signals a non-production configuration.
      if (checks[name] !== 'ok') throw Object.assign(new Error(`check ${name}=${checks[name]}`), { code: 'PROBE_UNREADY' });
    }
    return 'ready database-ok object-storage-ok configuration-ok';
  });

  await timed('api-metrics', async () => {
    const response = await fetchWithTimeout(fetchImpl, `${api}/metrics`, timeoutMs);
    if (response.status !== 200) throw Object.assign(new Error(`http-${response.status}`), { code: 'PROBE_HTTP' });
    const body = await readCapped(response, limits.maxJsonBytes, 'metrics');
    let payload = null;
    try { payload = JSON.parse(body.text); } catch { throw Object.assign(new Error('invalid json'), { code: 'PROBE_SCHEMA' }); }
    if (payload === null || typeof payload !== 'object') throw Object.assign(new Error('unexpected metrics payload'), { code: 'PROBE_SCHEMA' });
    return 'json-ok';
  });

  const finishedAt = new Date().toISOString();
  const ok = checks.length > 0 && checks.every((check) => check.ok);
  return { ok, startedAt, finishedAt, durationMs: Date.now() - started, frontendOrigin: frontend, apiOrigin: api, checks };
}

function renderHuman(result) {
  const lines = [
    `ops-probe ${result.ok ? 'OK' : 'FAIL'} in ${result.durationMs}ms`,
    `frontend ${result.frontendOrigin} api ${result.apiOrigin}`,
  ];
  for (const check of result.checks) {
    lines.push(`  ${check.ok ? 'ok' : 'FAIL'} ${check.name} (${check.durationMs}ms) ${check.detail}`);
  }
  return lines.join('\n');
}

function renderSummaryMarkdown(result) {
  const icon = result.ok ? '✅' : '❌';
  const lines = [
    `## Operations probe ${icon} ${result.ok ? 'OK' : 'FAIL'}`,
    '',
    `Targets: frontend \`${result.frontendOrigin}\`, api \`${result.apiOrigin}\`. Duration ${(result.durationMs / 1000).toFixed(1)}s.`,
    '',
    '| Check | Result | Detail |',
    '| --- | --- | --- |',
  ];
  for (const check of result.checks) {
    const safe = String(check.detail).replace(/\|/g, '/').slice(0, 160);
    lines.push(`| ${check.name} | ${check.ok ? 'ok' : 'FAIL'} | ${safe} |`);
  }
  lines.push('', 'Hourly monitoring is a readiness signal, not an SLA and not a keepalive.');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const result = await probeOperations({});
  if (args.has('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderHuman(result)}\n`);
  }
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(summaryPath, renderSummaryMarkdown(result));
  }
  process.exitCode = result.ok ? 0 : 1;
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';
const invokedDirectly = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`ops-probe fatal: ${error?.message || error}\n`);
    process.exitCode = 2;
  });
}
