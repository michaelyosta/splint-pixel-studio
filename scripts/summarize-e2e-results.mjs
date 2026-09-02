import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const inputPath = argument('--input', 'test-results/results.json');
const outputPath = argument('--output', 'test-results/e2e-summary.json');
const sha = argument('--sha', process.env.GITHUB_SHA || 'unknown');
const runId = argument('--run-id', process.env.GITHUB_RUN_ID || process.env.E2E_RUN_ID || 'local');
const shard = argument('--shard', process.env.E2E_SHARD || 'unknown');
const shardCount = argument('--shard-count', process.env.E2E_SHARD_COUNT || null);
const serverLog = argument('--server-log', process.env.E2E_SERVER_LOG || null);
const metricsPath = argument('--metrics', process.env.E2E_SERVER_METRICS_FILE || process.env.E2E_METRICS_FILE || null);

const ansiEscape = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
const stripAnsi = (value) => String(value || '').replace(ansiEscape, '');

function normalizeMessage(value) {
  return stripAnsi(value)
    .replace(/[A-Za-z]:\\[^\n ]+/g, '<path>')
    .replace(/https?:\/\/[^\s]+/g, '<url>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<uuid>')
    .replace(/X-User-Id:\s*[^\n]+/gi, 'X-User-Id: <user>')
    .replace(/\b(?:127\.0\.0\.1|localhost|::1):\d+\b/g, '<loopback>')
    .replace(/\b\d{4,}\b/g, '<number>')
    .replace(/^\s*\d+\s*\|.*$/gm, '<source>')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstError(testResult, spec) {
  const error = testResult.error || testResult.errors?.[0];
  const detail = testResult.errors?.find((item) => item.location)?.message;
  return stripAnsi(detail || error?.message || `${spec.file}:${spec.line || 0}`);
}

function attachmentPath(testResult, name) {
  return testResult.attachments?.find((attachment) => attachment.name === name)?.path || null;
}

function failureType(testResult) {
  if (testResult.status === 'timedOut') return 'TIMEOUT';
  if (testResult.status === 'failed') return 'ASSERTION_OR_RUNTIME';
  return String(testResult.status || 'UNKNOWN').toUpperCase();
}

const resolvedInputPath = resolve(inputPath);
const resolvedMetricsPath = metricsPath ? resolve(metricsPath) : null;
let serverMetrics = null;
if (resolvedMetricsPath && existsSync(resolvedMetricsPath)) {
  try {
    serverMetrics = JSON.parse(readFileSync(resolvedMetricsPath, 'utf8'));
  } catch (error) {
    serverMetrics = { report_available: false, error: error.message };
  }
}
const metrics = serverMetrics?.metrics || null;
const load = {
  shard_duration_ms: null,
  api_request_count: metrics?.httpRequests ?? null,
  api_error_count: metrics?.httpErrors ?? null,
  api_avg_latency_ms: metrics?.http_avg_duration_ms ?? null,
  api_p95_latency_ms: null,
  api_max_latency_ms: null,
};
if (!existsSync(resolvedInputPath)) {
  const missingInputSummary = {
    schema_version: 1,
    sha,
    run_id: runId,
    shard,
    shard_count: shardCount,
    generated_at: new Date().toISOString(),
    runtime: { node: process.version, playwright: process.env.PLAYWRIGHT_VERSION || null },
    report_available: false,
    server_metrics: serverMetrics,
    load,
    input_path: inputPath,
    failure_count: null,
    failures: [],
    clusters: [],
    diagnostic_note: 'Playwright JSON report was not produced; inspect the runner log for the primary failure.',
  };
  mkdirSync(dirname(resolve(outputPath)), { recursive: true });
  writeFileSync(resolve(outputPath), `${JSON.stringify(missingInputSummary, null, 2)}\n`);
  console.log(`E2E summary: input report missing; preserved diagnostic summary -> ${outputPath}`);
  process.exit(0);
}

const data = JSON.parse(readFileSync(resolvedInputPath, 'utf8'));
const failures = [];

function visitSuite(suite) {
  for (const spec of suite.specs || []) {
    for (const test of spec.tests || []) {
      for (const result of test.results || []) {
        if (!['failed', 'timedOut', 'interrupted'].includes(result.status)) continue;
        const message = firstError(result, spec);
        const messageSignature = normalizeMessage(message);
        failures.push({
          sha,
          run_id: runId,
          project: test.projectName || test.projectId || 'unknown',
          shard,
          test_id: spec.id || null,
          spec: spec.file || null,
          test: spec.title || null,
          fixture_run_id: process.env.E2E_FIXTURE_RUN_ID || null,
          worker: result.workerIndex ?? null,
          parallel_index: result.parallelIndex ?? null,
          ports: {
            web: process.env.E2E_WEB_PORT || null,
            api: process.env.E2E_API_PORT || null,
          },
          server_runtime: process.version,
          elapsed_run_time_ms: data.stats?.duration ?? null,
          test_duration_ms: result.duration ?? null,
          error_type: failureType(result),
          error_message: message,
          error_signature: messageSignature,
          failed_locator_or_assertion: message.split('Call log:')[0].trim(),
          failed_http_request: message.match(/(?:GET|POST|PUT|PATCH|DELETE)\s+https?:\/\/[^\s]+/i)?.[0] || null,
          http_status: null,
          trace_path: attachmentPath(result, 'trace'),
          screenshot_path: attachmentPath(result, 'screenshot'),
          server_log_reference: serverLog,
          retry: result.retry ?? 0,
        });
      }
    }
  }
  for (const child of suite.suites || []) visitSuite(child);
}

for (const suite of data.suites || []) visitSuite(suite);

const clusters = Object.values(failures.reduce((groups, failure) => {
  const key = failure.error_signature || 'unknown';
  groups[key] ||= { fingerprint: key, count: 0, affected_tests: [], projects: [], failures: [] };
  const cluster = groups[key];
  cluster.count += 1;
  cluster.affected_tests.push(`${failure.project} › ${failure.spec} › ${failure.test}`);
  if (!cluster.projects.includes(failure.project)) cluster.projects.push(failure.project);
  cluster.failures.push(failure);
  return groups;
}, {}));

const summary = {
  schema_version: 1,
  sha,
  run_id: runId,
  shard,
  shard_count: shardCount,
  generated_at: new Date().toISOString(),
  runtime: { node: process.version, playwright: process.env.PLAYWRIGHT_VERSION || null },
  report_available: true,
  stats: data.stats || null,
  server_metrics: serverMetrics,
  load: { ...load, shard_duration_ms: data.stats?.duration ?? null },
  failure_count: failures.length,
  failures,
  clusters,
};

mkdirSync(dirname(resolve(outputPath)), { recursive: true });
writeFileSync(resolve(outputPath), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`E2E summary: ${failures.length} failures, ${clusters.length} fingerprints -> ${outputPath}`);
