#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

export function evaluateSpecialQaProgress(progress, { expectedCohort = 'treatment' } = {}) {
  const diagnostics = progress?.special_diagnostics || null;
  const cohort = String(progress?.specials_experiment_group || 'unknown');
  const expected = String(expectedCohort || 'treatment').toLowerCase();
  const failures = [];
  if (cohort !== expected) failures.push(`cohort is ${cohort}; expected ${expected}`);
  if (!diagnostics) failures.push('server diagnostics are absent');
  if (expected === 'treatment' && diagnostics?.cohort_override !== true) {
    failures.push('the per-user QA override is not active');
  }
  if (expected === 'treatment' && Number(diagnostics?.special_count || 0) < 1) {
    failures.push('the template has no persisted Special candidates');
  }
  return {
    ok: failures.length === 0,
    failures,
    cohort,
    override: diagnostics?.cohort_override === true,
    template: {
      id: progress?.template_id || null,
      width: Number(diagnostics?.template_width || 0),
      height: Number(diagnostics?.template_height || 0),
      storage_mode: diagnostics?.storage_mode || null,
    },
    generation_version: Number(diagnostics?.generation_version || 0),
    candidates: Number(diagnostics?.special_count || 0),
    by_kind: diagnostics?.counts_by_kind || null,
    by_status: diagnostics?.counts_by_status || null,
  };
}

export function parseArgs(argv = []) {
  const parsed = {
    api: 'http://127.0.0.1:3001',
    template: '',
    expectedCohort: 'treatment',
    user: process.env.VITE_DEV_USER_ID || '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--api' && value) parsed.api = value, index += 1;
    else if (key === '--template' && value) parsed.template = value, index += 1;
    else if (key === '--expect' && value) parsed.expectedCohort = value.toLowerCase(), index += 1;
    else if (key === '--user' && value) parsed.user = value, index += 1;
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.template || !args.user || !['treatment', 'control'].includes(args.expectedCohort)) {
    console.error('Usage: npm run qa:specials -- --template <id> [--expect treatment|control] [--user <dev-user>] [--api <url>]');
    process.exitCode = 2;
    return;
  }
  const response = await fetch(`${args.api.replace(/\/$/, '')}/colorings/${encodeURIComponent(args.template)}/progress`, {
    headers: { 'X-User-Id': args.user },
  });
  const progress = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`Special QA preflight failed: HTTP ${response.status} ${progress?.code || progress?.error || ''}`.trim());
    process.exitCode = 1;
    return;
  }
  const result = evaluateSpecialQaProgress(progress, { expectedCohort: args.expectedCohort });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    console.error('Special QA preflight failed. Enable the allowlisted dev/test override and diagnostics, restart the API supervisor, then rerun this command.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
