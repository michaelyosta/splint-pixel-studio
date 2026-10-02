// Public operations probe for Splint: minimal live frontend/API readiness.
// Stdlib only (global fetch/AbortController). One attempt per endpoint, no
// retries. Independent checks run as one batch. Never sends credentials and
// never logs response bodies, queries, or userinfo: details carry only safe
// origins, asset ordinals, and status words.
//
// Usage:
//   node scripts/ops-probe.mjs [--json]
// Probes the locked production origins below. Deterministic failure and
// recovery drills live in test/ops-probe.test.js against localhost stubs.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function probeError(message, code) {
  return Object.assign(new Error(message), { code });
}

// Single timeout covering DNS/connect/headers AND the full capped body read.
// The timer starts before fetch and is cleared only after the body is fully
// consumed (or the fetch fails), so a stalled body cannot outlive timeoutMs.
async function fetchCappedText(fetchImpl, url, { timeoutMs, maxBytes, label }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = null;
    try {
      response = await fetchImpl(url, { signal: controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError') throw probeError(`timeout ${label} after ${timeoutMs}ms`, 'PROBE_TIMEOUT');
      throw error;
    }
    if (!response.body) return { response, text: '', bytes: 0 };
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch { /* reader already closed */ }
          throw probeError(`${label} exceeds ${maxBytes} bytes`, 'PROBE_TOO_LARGE');
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw probeError(`timeout ${label} after ${timeoutMs}ms`, 'PROBE_TIMEOUT');
      throw error;
    }
    const merged = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    return { response, text: merged.toString('utf8'), bytes: total };
  } finally {
    clearTimeout(timer);
  }
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

function parseAssetUrl(absolute) {
  try {
    return new URL(absolute);
  } catch {
    return null;
  }
}

function isSameOrigin(absoluteUrl, baseOrigin) {
  try {
    return new URL(absoluteUrl).origin === new URL(baseOrigin).origin;
  } catch {
    return false;
  }
}

// An asset URL carrying userinfo is never fetched and never printed back:
// credentials in markup must fail closed, not flow into requests or logs.
function hasCredentials(parsed) {
  return Boolean(parsed && (parsed.username || parsed.password));
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

  const runCheck = async (name, fn) => {
    const begin = Date.now();
    try {
      const detail = await fn();
      return checkResult(name, true, detail, Date.now() - begin);
    } catch (error) {
      return checkResult(name, false, `${error?.code || 'PROBE_ERROR'}: ${error?.message || error}`, Date.now() - begin);
    }
  };

  let homeText = '';
  let assetRefs = [];
  const homeCheck = await runCheck('frontend-home', async () => {
    const { response, text, bytes } = await fetchCappedText(fetchImpl, `${frontend}/`, {
      timeoutMs, maxBytes: limits.maxHtmlBytes, label: 'homepage',
    });
    if (response.status !== 200) throw probeError(`http-${response.status}`, 'PROBE_HTTP');
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) throw probeError(`unexpected content-type`, 'PROBE_SCHEMA');
    homeText = text;
    if (!homeText.includes(ROOT_MARKER)) throw probeError('missing root marker', 'PROBE_SCHEMA');
    if (!homeText.includes(TITLE_MARKER)) throw probeError('missing title marker', 'PROBE_SCHEMA');
    assetRefs = extractAssetRefs(homeText, frontend);
    return `http-200 html-${bytes}b refs-${assetRefs.length}`;
  });

  // The frontend subtree: asset census, fetch, and binding. Runs as one unit
  // because binding needs the fetched bundle bodies. Independent from the
  // backend checks, so it shares a batch with them below.
  const frontendUnit = async () => {
    const out = [];
    if (!homeCheck.ok) return out;
    const foreign = assetRefs.filter((ref) => !isSameOrigin(ref.absolute, frontend));
    const credentialed = assetRefs.filter((ref) => {
      if (isSameOrigin(ref.absolute, frontend)) {
        const parsed = parseAssetUrl(ref.absolute);
        return hasCredentials(parsed);
      }
      return false;
    });
    const unexpected = foreign.filter((ref) => !EXTERNAL_SCRIPT_ALLOWLIST.includes(ref.absolute));
    const blocked = [...unexpected, ...credentialed];
    if (blocked.length > 0) {
      const origins = [...new Set(blocked.map((ref) => {
        try { return new URL(ref.absolute).origin; } catch { return 'unparseable-origin'; }
      }))].slice(0, 3);
      out.push(checkResult('frontend-assets', false, `unexpected foreign assets: ${origins.join(', ')}`, 0));
      out.push(checkResult('api-binding', false, 'skipped: asset census failed', 0));
      return out;
    }
    const skippedAllowed = foreign.length;
    const local = assetRefs.filter((ref) => isSameOrigin(ref.absolute, frontend));
    if (local.length > limits.maxAssets) {
      out.push(checkResult('frontend-assets', false, `too many assets: ${local.length} > ${limits.maxAssets}`, 0));
      out.push(checkResult('api-binding', false, 'skipped: asset census failed', 0));
      return out;
    }
    if (!local.some((ref) => ref.kind === 'script')) {
      out.push(checkResult('frontend-assets', false, 'no same-origin script entry', 0));
      out.push(checkResult('api-binding', false, 'skipped: asset census failed', 0));
      return out;
    }
    let sameOriginJs = [];
    out.push(await runCheck('frontend-assets', async () => {
      const fetched = await Promise.all(local.map(async (ref, index) => {
        const label = `asset[${index}] ${ref.kind}`;
        const { response, text, bytes } = await fetchCappedText(fetchImpl, ref.absolute, {
          timeoutMs,
          maxBytes: ref.kind === 'script' ? limits.maxAssetBytes : limits.maxJsonBytes,
          label,
        });
        if (response.status !== 200) throw probeError(`http-${response.status} ${label}`, 'PROBE_HTTP');
        return { ref, text: ref.kind === 'script' ? text : '', bytes };
      }));
      sameOriginJs = fetched.filter((entry) => entry.ref.kind === 'script');
      return `fetched-${fetched.length} skipped-foreign-${skippedAllowed}`;
    }));
    const assetsOk = out[out.length - 1].ok;
    if (!assetsOk) {
      out.push(checkResult('api-binding', false, 'skipped: asset fetch failed', 0));
      return out;
    }
    out.push(await runCheck('api-binding', async () => {
      const expected = normalizeOrigin(expectedApiOrigin);
      const hit = sameOriginJs.some((entry) => entry.text.includes(expected));
      if (!hit) throw probeError(`expected API origin absent from ${sameOriginJs.length} same-origin scripts`, 'PROBE_BINDING');
      return 'api-origin present in bundle';
    }));
    return out;
  };

  const liveCheck = () => runCheck('api-live', async () => {
    const { response, text } = await fetchCappedText(fetchImpl, `${api}/live`, {
      timeoutMs, maxBytes: limits.maxJsonBytes, label: '/live',
    });
    if (response.status !== 200) throw probeError(`http-${response.status}`, 'PROBE_HTTP');
    let payload = null;
    try { payload = JSON.parse(text); } catch { throw probeError('invalid json', 'PROBE_SCHEMA'); }
    if (payload?.status !== 'alive') throw probeError('unexpected live payload', 'PROBE_SCHEMA');
    return 'alive';
  });

  const healthCheck = () => runCheck('api-health', async () => {
    const { response, text } = await fetchCappedText(fetchImpl, `${api}/health`, {
      timeoutMs, maxBytes: limits.maxJsonBytes, label: '/health',
    });
    if (response.status !== 200) throw probeError(`http-${response.status}`, 'PROBE_HTTP');
    let payload = null;
    try { payload = JSON.parse(text); } catch { throw probeError('invalid json', 'PROBE_SCHEMA'); }
    if (payload?.status !== 'ok') throw probeError('unexpected health payload', 'PROBE_SCHEMA');
    const timestamp = Date.parse(payload.timestamp);
    if (!Number.isFinite(timestamp)) throw probeError('invalid health timestamp', 'PROBE_SCHEMA');
    if (Math.abs(Date.now() - timestamp) > 10 * 60 * 1000) throw probeError('stale health timestamp', 'PROBE_SCHEMA');
    return 'ok';
  });

  const readyCheck = () => runCheck('api-ready', async () => {
    const { response, text } = await fetchCappedText(fetchImpl, `${api}/ready`, {
      timeoutMs, maxBytes: limits.maxJsonBytes, label: '/ready',
    });
    let payload = null;
    try { payload = JSON.parse(text); } catch { throw probeError(`http-${response.status} invalid json`, 'PROBE_SCHEMA'); }
    if (response.status !== 200 || payload?.ready !== true) {
      throw probeError(`unready http-${response.status} ready-${payload?.ready}`, 'PROBE_UNREADY');
    }
    const readyChecks = payload.checks || {};
    for (const name of ['database', 'object_storage', 'configuration']) {
      // Strict production gate: only literal `ok` passes. The server also
      // treats `development` as ready, which must never satisfy production
      // monitoring because it signals a non-production configuration.
      if (readyChecks[name] !== 'ok') {
        throw probeError(`check ${name}=${String(readyChecks[name]).slice(0, 40)}`, 'PROBE_UNREADY');
      }
    }
    return 'ready database-ok object-storage-ok configuration-ok';
  });

  const metricsCheck = () => runCheck('api-metrics', async () => {
    const { response, text } = await fetchCappedText(fetchImpl, `${api}/metrics`, {
      timeoutMs, maxBytes: limits.maxJsonBytes, label: '/metrics',
    });
    if (response.status !== 200) throw probeError(`http-${response.status}`, 'PROBE_HTTP');
    let payload = null;
    try { payload = JSON.parse(text); } catch { throw probeError('invalid json', 'PROBE_SCHEMA'); }
    if (payload === null || typeof payload !== 'object') throw probeError('unexpected metrics payload', 'PROBE_SCHEMA');
    return 'json-ok';
  });

  const [frontendChecks, live, health, ready, metrics] = await Promise.all([
    frontendUnit(),
    liveCheck(),
    healthCheck(),
    readyCheck(),
    metricsCheck(),
  ]);
  const checks = [homeCheck, ...frontendChecks, live, health, ready, metrics];

  const finishedAt = new Date().toISOString();
  const ok = checks.length > 0 && checks.every((check) => check.ok);
  return { ok, startedAt, finishedAt, durationMs: Date.now() - started, frontendOrigin: frontend, apiOrigin: api, checks };
}

export function renderHuman(result) {
  const lines = [
    `ops-probe ${result.ok ? 'OK' : 'FAIL'} in ${result.durationMs}ms`,
    `frontend ${result.frontendOrigin} api ${result.apiOrigin}`,
  ];
  for (const check of result.checks) {
    lines.push(`  ${check.ok ? 'ok' : 'FAIL'} ${check.name} (${check.durationMs}ms) ${check.detail}`);
  }
  return lines.join('\n');
}

export function renderSummaryMarkdown(result) {
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
  lines.push('', 'On red: review this summary immediately, run one bounded re-dispatch, then check provider dashboards if still red.');
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

const invokedDirectly = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`ops-probe fatal: ${error?.message || error}\n`);
    process.exitCode = 2;
  });
}
